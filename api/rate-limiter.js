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
 * Makes an API request with retry logic for rate limiting (429 errors)
 * @param {Function} requestFn - Function that makes the API request
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.baseDelay - Base delay in milliseconds (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in milliseconds (default: 10000)
 * @param {number} options.backoffMultiplier - Backoff multiplier (default: 2)
 * @returns {Promise} - Promise that resolves with the response or rejects with error
 */
async function makeRateLimitedRequest(requestFn, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 10000,
        backoffMultiplier = 2
    } = options;

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await requestFn();
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
    return makeRateLimitedRequest(
        () => axios(axiosConfig),
        retryOptions
    );
}

export {
    makeRateLimitedRequest,
    makeRateLimitedAxiosRequest,
    sleep
};