const { Storage } = require('@google-cloud/storage');
const storage = new Storage();

const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const FILE_NAME = 'streamsync-data.json';

/**
 * Loads the application state from GCS.
 * Returns a default object if the file doesn't exist or if bucket is not configured.
 */
async function loadData() {
    if (!BUCKET_NAME) {
        console.warn('GCS_BUCKET_NAME not set, using in-memory mock data (will not persist).');
        return { users: {}, cameras: {} };
    }
    try {
        const file = storage.bucket(BUCKET_NAME).file(FILE_NAME);
        const [exists] = await file.exists();
        if (!exists) {
            console.log('No existing state found in GCS. Starting fresh.');
            return { users: {}, cameras: {} };
        }
        const [content] = await file.download();
        return JSON.parse(content.toString());
    } catch (err) {
        console.error('Error loading data from GCS:', err);
        return { users: {}, cameras: {} };
    }
}

/**
 * Saves the application state to GCS.
 */
async function saveData(data) {
    if (!BUCKET_NAME) return;
    try {
        const file = storage.bucket(BUCKET_NAME).file(FILE_NAME);
        await file.save(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error saving data to GCS:', err);
    }
}

module.exports = { loadData, saveData };
