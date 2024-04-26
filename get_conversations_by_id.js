const axios = require('axios');
// Import the fs module for file system operations
const fs = require('fs');
const fsp = require('fs').promises; // Use fs.promises for promise-based operations
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const Bottleneck = require('bottleneck');

// Create a bottleneck limiter
const limiter = new Bottleneck({
    minTime: 3100,  // Around 3.1 seconds between requests to fit 198 requests in 10 minutes
    maxConcurrent: 1  // Only one request at a time
});

async function loadConversationIDs(filePath) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8'); // Correct usage with promises
        return content.split('\n').filter(Boolean); // Filter out empty lines
    } catch (error) {
        console.log("No processed IDs file found, starting fresh.");
        return new Set(); // Return an empty set if the file doesn't exist
    }
}

async function loadProcessedIDs(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return new Set(content.split('\n').filter(Boolean)); // Use a Set for fast lookup
    } catch (error) {
        console.log("No processed IDs file found, starting fresh.");
        return new Set(); // Return an empty set if the file doesn't exist
    }
}

async function markAsDone(processedFilePath, conversationId) {
    try {
        // Correctly use fs.promises.appendFile without a callback
        await fsp.appendFile(processedFilePath, `${conversationId}\n`, 'utf8');
        console.log(`Marked conversation ID ${conversationId} as done.`);
    } catch (error) {
        console.error('Error saving processed ID:', error);
    }
}

const tokenURL = 'https://api.helpscout.net/v2/oauth2/token';

async function getAccessToken() {
    try {
        const response = await axios.post(tokenURL, {
            grant_type: 'client_credentials',
            client_id: clientID,
            client_secret: clientSecret
        });
        console.log('Access Token:', response.data.access_token);
        return response.data.access_token;
    } catch (error) {
        console.error('Failed to retrieve access token:', error);
        throw new Error('Failed to retrieve access token.');
    }
}

const BASE_URL = "https://api.helpscout.net/v2";
const CSV_FILE = "conversations.csv";
const CONVERSATION_IDS_FILE = "conversations_ids.txt";
const ATTACHMENTS_DIR = "attachments";

// Rate limited fetch for conversations
const fetchConversation = async (accessToken, conversationId) => {
    return await limiter.schedule(async () => {  // Ensure the result of limiter.schedule is returned
        console.log(`Fetching conversation with ID: ${conversationId}`);
        try {
            const response = await axios.get(`${BASE_URL}/conversations/${conversationId}`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (response && response.data) {
                console.log(`Conversation with ID ${conversationId} retrieved successfully.`);
                return response.data;  // Make sure to return data here
            } else {
                console.log(`No data returned for Conversation ID: ${conversationId}`);
                return null;
            }
        } catch (error) {
            console.error(`Error fetching conversation with ID ${conversationId}:`, error.response ? error.response.status : error);
            return null;
        }
    });
};


// Rate limited fetch for threads
const fetchThreads = async (accessToken, conversationId) => {
    return await limiter.schedule(async () => {
        console.log(`Fetching threads for Conversation ID: ${conversationId}`);
        try {
            const response = await axios.get(`${BASE_URL}/conversations/${conversationId}/threads`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            console.log(`Threads for Conversation ID ${conversationId} retrieved successfully.`);
            return response.data._embedded.threads;
        } catch (error) {
            console.error(`Error fetching threads for Conversation ID ${conversationId}:`, error.response ? error.response.status : error);
            return [];
        }
    });
};

const sanitizeHtml = (html) => {
    return html
        .replace(/<\/?[^>]+(>|$)/g, "") // Removes HTML tags
        .replace(/\r?\n|\r/g, " "); // Replaces new lines and carriage returns with a space
};

const csvWriter = createCsvWriter({
    path: CSV_FILE,
    header: [
        { id: 'id', title: 'ID' },
        { id: 'subject', title: 'Subject' },
        { id: 'status', title: 'Status' },
        { id: 'customerEmail', title: 'Customer Email' },
        { id: 'createdAt', title: 'Created At' },
        { id: 'closedAt', title: 'Closed At' },
        { id: 'assigneeName', title: 'Assignee Name' },
        { id: 'tags', title: 'Tags' },
        { id: 'type', title: 'Type' },
        { id: 'threads', title: 'Threads' },
        { id: 'attachments', title: 'Attachments' }
    ],
    append: true // This is set to true to append to the file instead of overwriting it
});

// Use fs for createWriteStream
const downloadAttachment = async (accessToken, url, folder, filename) => {
    console.log(`Downloading attachment from: ${url}`);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    // Ensure the directory exists before trying to write to it
    await fsp.mkdir(folder, { recursive: true });

    const writer = fs.createWriteStream(path.join(folder, filename));
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', () => {
            console.log(`Successfully downloaded and saved ${filename}`);
            resolve();
        });
        writer.on('error', reject);
    });
};

const fetchThreadsAndAttachments = async (accessToken, conversation) => {
    const threads = await fetchThreads(accessToken, conversation.id);
    let attachments = [];
    let threadDetails = [];

    console.log(`Total threads fetched: ${threads.length}`);

    for (const thread of threads) {
        console.log(`Thread ID ${thread.id} Data:`, thread);

        let threadText = sanitizeHtml(thread.body || thread.action.text || 'No Content');
        threadDetails.push(threadText);

        if (thread._embedded && thread._embedded.attachments && thread._embedded.attachments.length > 0) {
            console.log(`Found ${thread._embedded.attachments.length} attachments in thread ID ${thread.id}`);

            for (const attachment of thread._embedded.attachments) {
                console.log(`Attachment Data: ${JSON.stringify(attachment)}`);

                const filename = attachment.filename;  // Using the correct property name
                if (!filename) {
                    console.error('Filename is undefined, skipping download for this attachment.');
                    continue;
                }

                const attachmentUrl = attachment._links.data.href;  // Correctly using the 'data' href for API downloads
                console.log(`Attempting to download attachment from: ${attachmentUrl}`);

                try {
                    await downloadAttachment(accessToken, attachmentUrl, path.join(ATTACHMENTS_DIR, String(conversation.id)), filename);
                    attachments.push(`${path.join(ATTACHMENTS_DIR, String(conversation.id))}/${filename}`);
                    console.log(`Attachment ${filename} downloaded successfully.`);
                } catch (downloadError) {
                    console.error(`Failed to download attachment ${filename}:`, downloadError);
                }
            }
        } else {
            console.log(`No attachments found in thread ID ${thread.id}`);
        }
    }

    return { threadDetails: threadDetails.join('; '), attachments };
};

const saveToCsv = async (accessToken, conversation) => {
    const { threadDetails, attachments } = await fetchThreadsAndAttachments(accessToken, conversation);
    const customerEmail = conversation.primaryCustomer.email;
    const createdAt = conversation.createdAt;
    const closedAt = conversation.closedAt || 'Not Closed';
    const assigneeName = conversation.assignee ? `${conversation.assignee.first} ${conversation.assignee.last}` : 'Unassigned';
    const tags = conversation.tags.map(tag => tag.tag).join(', ');
    const type = conversation.type;

    console.log(`Saving conversation ID ${conversation.id} to CSV`);
    await csvWriter.writeRecords([{
        id: conversation.id,
        subject: conversation.subject,
        status: conversation.status,
        customerEmail: customerEmail,
        createdAt: createdAt,
        closedAt: closedAt,
        assigneeName: assigneeName,
        tags: tags,
        type: type,
        threads: threadDetails,
        attachments: attachments.join(', ')
    }]);
    console.log(`Conversation ID ${conversation.id} saved to CSV successfully.`);
};

const main = async () => {
    const accessToken = await getAccessToken();
    const conversationIds = await loadConversationIDs(CONVERSATION_IDS_FILE);
    const processedIds = await loadProcessedIDs("processed_ids.txt");

    for (const id of conversationIds) {
        if (processedIds.has(id)) {
            console.log(`Skipping processed conversation ID: ${id}`);
            continue;
        }

        const conversation = await fetchConversation(accessToken, id);
        if (conversation) {
            await saveToCsv(accessToken, conversation);
            await markAsDone("processed_ids.txt", id);
            processedIds.add(id); // Add to the Set to keep track during the session
            console.log(`Conversation ID: ${id} processed and marked as done.`);
        } else {
            console.log(`Conversation with ID ${id} not found. Skipping...`);
        }
    }

    console.log('Finished fetching conversation details.');
};

main().catch(error => console.error(`An error occurred: ${error}`));
