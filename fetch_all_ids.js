const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const Bottleneck = require('bottleneck');

// Set up the Help Scout API credentials and URLs
const clientID = 'XXXXXXXX';  // Replace with your actual Client ID
const clientSecret = 'XXXXXXX';  // Replace with your actual Client Secret
const tokenURL = 'https://api.helpscout.net/v2/oauth2/token';
const BASE_URL = "https://api.helpscout.net/v2";
const CONVERSATIONS_FILE = path.join(__dirname, "conversations_ids.txt");
const CSV_FILE = path.join(__dirname, "conversations.csv");

// Create a bottleneck limiter
const limiter = new Bottleneck({
    minTime: 3100,  // Adjusted for 200 requests every 10 minutes
    maxConcurrent: 1
});

// Initialize the CSV writer
const csvWriter = createCsvWriter({
    path: CSV_FILE,
    header: [
        { id: 'id', title: 'ID' },
        { id: 'subject', title: 'Subject' },
        { id: 'status', title: 'Status' },
        // Add more headers based on the conversation details you want to include
    ]
});

// Function to get an access token
async function getAccessToken() {
    console.log('Requesting access token...');
    const response = await axios.post(tokenURL, {
        grant_type: 'client_credentials',
        client_id: clientID,
        client_secret: clientSecret
    });
    console.log('Access token received.');
    return response.data.access_token;
}

// Function to fetch conversation IDs from a given page
async function fetchConversationIDs(accessToken, page) {
    try {
        console.log(`Fetching conversation IDs from page ${page}...`);
        const response = await limiter.schedule(() => axios.get(`${BASE_URL}/conversations?page=${page}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        }));
        return response.data._embedded.conversations.map(conversation => conversation.id);
    } catch (error) {
        console.error(`Error fetching conversation IDs from page ${page}:`, error.response ? error.response.data : error.message);
        return [];
    }
}
// Helper function to make the API call
async function fetchAPI(url, accessToken) {
    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return response.json();
}

// Function to fetch and save conversation IDs
async function fetchAndSaveConversationIDs(accessToken) {
    console.log('Fetching conversation IDs...');

    // First fetch to determine the number of pages
    const initialUrl = 'https://api.helpscout.net/v2/conversations?status=all';
    const initialData = await fetchAPI(initialUrl, accessToken);
    totalPages = initialData.page.totalPages;
    //totalPages = 1;
    const totalElements = initialData.page.totalElements;
    console.log(`Total conversations to fetch: ${totalElements} across ${totalPages} pages.`);

    let allConversationIDs = [];
    
    // Fetch all conversation IDs across pages
    for (let page = 1; page <= totalPages; page++) {
        const pageUrl = `https://api.helpscout.net/v2/conversations?status=all&page=${page}`;
        const data = await fetchAPI(pageUrl, accessToken);
        const conversationIDs = data._embedded.conversations.map(conv => conv.id);
        allConversationIDs = [...allConversationIDs, ...conversationIDs];
        console.log(`Fetched page ${page} with ${conversationIDs.length} IDs.`);
    }

    console.log(`Total conversation IDs fetched: ${allConversationIDs.length}`);
    await fs.writeFile(CONVERSATIONS_FILE, allConversationIDs.join('\n'));
    console.log('Conversation IDs saved to file.');
}

// Function to fetch and write conversation details to CSV
async function fetchAndWriteConversation(accessToken, conversationId) {
    try {
        console.log(`Fetching details for conversation ID: ${conversationId}`);
        const response = await limiter.schedule(() => axios.get(`${BASE_URL}/conversations/${conversationId}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        }));

        const conversation = response.data;
        // Format the conversation data into the structure required by your CSV
        const record = {
            id: conversation.id,
            subject: conversation.subject,
            status: conversation.status,
            // ... include other fields as required
        };

        // Write the formatted record to the CSV file
        await csvWriter.writeRecords([record]);
        console.log(`Conversation ID: ${conversationId} written to CSV`);
    } catch (error) {
        console.error(`Error fetching conversation ID ${conversationId}:`, error);
        throw error; // Re-throw to signal that this ID was not processed successfully
    }
}

// Function to process all conversations from the ID list file
async function processConversations(accessToken) {
    let conversationIDs = await fs.readFile(CONVERSATIONS_FILE, 'utf8');
    conversationIDs = conversationIDs.split('\n').filter(Boolean); // Convert file content into an array of IDs

    for (let i = 0; i < conversationIDs.length; i++) {
        const conversationId = conversationIDs[i];

        try {
            await fetchAndWriteConversation(accessToken, conversationId);
            // Remove the processed ID from the array
            conversationIDs.splice(i, 1);
            i--; // Adjust the index since we've modified the array

            // Update the file with the remaining IDs
            await fs.writeFile(CONVERSATIONS_FILE, conversationIDs.join('\n'));
        } catch (error) {
            console.error(`Failed to process conversation ID: ${conversationId}`, error);
            // Optional: Decide if you want to stop the process or continue with the next ID
        }
    }

    console.log('Finished processing all conversations.');
}

// Main execution function
async function main() {
    const accessToken = await getAccessToken();
    await fetchAndSaveConversationIDs(accessToken); // Run this to fetch all conversation IDs
    //await processConversations(accessToken); // Comment this out for now
}

main().catch(console.error);
