/**
 * Rate limiting utility for handling API requests with retry logic
 */

import axios from 'axios';

/**
 * Sleep function for delays
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Global request queue to prevent concurrent requests
 */
class RequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastRequestTime = 0;
        this.minRequestInterval = 2000; // Minimum 2 seconds between requests
    }

    async addRequest(requestFn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ requestFn, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const { requestFn, resolve, reject } = this.queue.shift();
            
            try {
                // Ensure minimum interval between requests
                const timeSinceLastRequest = Date.now() - this.lastRequestTime;
                if (timeSinceLastRequest < this.minRequestInterval) {
                    const waitTime = this.minRequestInterval - timeSinceLastRequest;
                    console.log(`⏳ Waiting ${waitTime}ms before next request to respect rate limits`);
                    await sleep(waitTime);
                }

                this.lastRequestTime = Date.now();
                const result = await requestFn();
                resolve(result);
            } catch (error) {
                reject(error);
            }
        }

        this.processing = false;
    }
}

// Global request queue instance
const requestQueue = new RequestQueue();

/**
 * Makes an API request with retry logic for rate limiting (429 errors)
 * @param {Function} requestFn - Function that makes the API request
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum number of retries (default: 5)
 * @param {number} options.baseDelay - Base delay in milliseconds (default: 5000)
 * @param {number} options.maxDelay - Maximum delay in milliseconds (default: 60000)
 * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
 * @param {boolean} options.useQueue - Whether to use the request queue (default: true)
 * @returns {Promise} - Promise that resolves with the response or rejects with error
 */
async function makeRateLimitedRequest(requestFn, options = {}) {
    const {
        maxRetries = 5,
        baseDelay = 5000,
        maxDelay = 60000,
        backoffMultiplier = 2,
        useQueue = true
    } = options;

    // Wrap the request function with queue if enabled
    const wrappedRequestFn = useQueue 
        ? () => requestQueue.addRequest(requestFn)
        : requestFn;

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await wrappedRequestFn();
            return response;
        } catch (error) {
            lastError = error;
            
            // Check if it's a rate limit error (429)
            if (error.response && error.response.status === 429) {
                if (attempt === maxRetries) {
                    console.error(`❌ Rate limit exceeded after ${maxRetries + 1} attempts`);
                    throw error;
                }
                
                // Calculate delay with exponential backoff
                const delay = Math.min(
                    baseDelay * Math.pow(backoffMultiplier, attempt),
                    maxDelay
                );
                
                console.warn(`⚠️ Rate limit hit (429), retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
                await sleep(delay);
                continue;
            }
            
            // For non-rate-limit errors, throw immediately
            throw error;
        }
    }
    
    throw lastError;
}

/**
 * Creates a rate-limited version of an axios request
 * @param {Object} axiosConfig - Axios configuration object
 * @param {Object} retryOptions - Retry configuration options
 * @returns {Promise} - Promise that resolves with the response
 */
async function makeRateLimitedAxiosRequest(axiosConfig, retryOptions = {}) {
    // Use more aggressive rate limiting by default
    const defaultOptions = {
        maxRetries: 5,
        baseDelay: 5000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        useQueue: true,
        ...retryOptions
    };

    return makeRateLimitedRequest(
        () => axios(axiosConfig),
        defaultOptions
    );
}

export {
    makeRateLimitedRequest,
    makeRateLimitedAxiosRequest,
    sleep,
    requestQueue
};