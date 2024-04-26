Project Overview
The goal is to download all conversations (email threads) from Helpscout. It seems there is no other way to get all the history of past communications. Using its API seems to be the only way. Let me know if I am mistaken.
This project consists of two JavaScript files that interact with the HelpScout API to fetch and store email conversation threads across all mailboxes.

fetch_all_ids.js
Description: This script retrieves all conversation IDs from all mailboxes.

Functionality:

Determines the number of pages (with 25 entries per page).
Iteratively requests all conversation IDs on each page.
Output: Generates a text file named conversations_ids.txt containing all the conversation IDs.

get_conversations_by_id.js
Description: This script fetches and processes each conversation using its unique ID.

Functionality:

Requests the entire content of each conversation (an email thread including all interactions in HTML format).
Strips the HTML content to retain text only.
Downloads any attachments and saves them in a subdirectory named after the conversation ID.
Logs each conversation in an output CSV file, including links to the attachment files.
Tracks processed conversation IDs in process_id.txt to resume operation in case of termination.
Note on API Rate Limits: HelpScout API access is limited by rate, with the lowest tier allowing 200 requests per ten minutes. Each script includes a rate limit parameter, which typically does not require adjustment if using the default tier.

Running the Scripts
Prerequisites: Ensure your environment has Node.js and npm installed.

Steps:

Clone the code repository into your local directory.
Run node fetch_all_ids.js to generate conversations_ids.txt. Install any missing packages by running npm install <package_name>.
Once you have the conversations_ids.txt, execute node get_conversations_by_id.js. Note that processing a large number of email threads (e.g., 20,000) can take a considerable amount of time due to API rate limits.
