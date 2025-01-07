const puppeteer = require('puppeteer');
const TorControl = require('tor-control');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { faker } = require('@faker-js/faker');

// Configuration
// get values from env of docker
const TOR_HOST = String(process.env.TOR_HOST) || '127.0.0.1'; // Tor service host
// const TOR_HOST = '192.168.100.171'; // Tor service host
const TOR_CONTROL_BASE_PORT = parseInt(process.env.TOR_CONTROL_BASE_PORT, 10) || 7001; // Tor control port
const TOR_PROXY_BASE_PORT = parseInt(process.env.TOR_PROXY_BASE_PORT, 10) || 9001; // Base Tor proxy port
const TOR_CONTROL_PASSWORD = String(process.env.TOR_CONTROL_PASSWORD) || ''; // Tor control password
const YOUTUBE_CHANNEL_URL = String(process.env.YOUTUBE_CHANNEL_URL) || 'https://www.youtube.com/@WION';
const YOUTUBE_URL = String(process.env.YOUTUBE_URL) || 'https://www.youtube.com/watch?v=BPydARoYxa4';
const RERUN_TIMES = parseInt(process.env.RERUN_TIMES, 10) || 10;
const TOR_POOL_SIZE = parseInt(process.env.TOR_POOL_SIZE, 10) || 10; // Number of Tor instances in the pool

// Create a pool of Tor instances
const torInstances = Array.from({ length: TOR_POOL_SIZE }, (_, index) => ({
    proxyPort: TOR_PROXY_BASE_PORT + index,
    controlPort: TOR_CONTROL_BASE_PORT + index,
    control: new TorControl({
        host: TOR_HOST,
        port: TOR_CONTROL_BASE_PORT + index,
        password: TOR_CONTROL_PASSWORD,
    }),
}));

// Track used IPs
const usedIps = new Set();

// Request a new unique Tor IP
async function requestUniqueTorIp(torInstance, sessionId) {
    let newIp;
    const maxRetries = 20; // Increased retries
    const retryDelay = 10000; // Delay in milliseconds

    for (let i = 0; i < maxRetries; i++) {
        await requestNewTorIdentity(torInstance, sessionId);
        await new Promise(resolve => setTimeout(resolve, retryDelay)); // Add delay for IP change
        newIp = await getTorIp(torInstance, sessionId);
        // newIp = sessionId;

        if (!usedIps.has(newIp)) {
            usedIps.add(newIp); // Mark the IP as used globally
            console.log(`Session ${sessionId}: Unique IP acquired: ${newIp}`);
            return newIp;
        } else {
            console.log(`Session ${sessionId}: Duplicate IP detected (${newIp}). Retrying...`);
        }
    }

    console.warn(`Session ${sessionId}: Unable to get a unique IP after ${maxRetries} retries. Proceeding with duplicate IP: ${newIp}`);
    return newIp; // Return the duplicate IP as a fallback
}

// Request a new Tor identity
function requestNewTorIdentity(torInstance, sessionId) {
    return new Promise((resolve, reject) => {
        console.log(`Session ${sessionId}: Requesting new Tor identity.`);
        torInstance.control.signalNewnym((err) => {
            if (err) {
                console.error(`Session ${sessionId}: Failed to request new Tor identity:`, err);
                reject(err);
            } else {
                console.log(`Session ${sessionId}: New Tor identity requested.`);
                setTimeout(resolve, 5000); // Wait for the new identity to take effect
            }
        });
    });
}

// Get current Tor IP
async function getTorIp(torInstance, sessionId) {
    try {
        console.log(`Session ${sessionId} ${torInstance.proxyPort}: Getting Tor IP...`);

        // Construct the SOCKS5 proxy URL
        const proxyUrl = `socks5h://${TOR_HOST}:${torInstance.proxyPort}`;
        const agent = new SocksProxyAgent(proxyUrl);

        // Test connection through the proxy
        const response = await axios.get('https://api.ipify.org?format=json', {
            httpAgent: agent, // Use the SOCKS5 agent for HTTP requests
            httpsAgent: agent, // Use the SOCKS5 agent for HTTPS requests
            timeout: 20000, // Increase timeout to 20 seconds
        });

        const torIp = response.data.ip;
        console.log(`Session ${sessionId}: Current Tor IP is ${torIp}`);
        return torIp;
    } catch (error) {
        console.error(`Session ${sessionId}: Failed to get Tor IP: ${error.message}`);
        throw error;
    }
}

// Simulate low bandwidth conditions by setting network throttling
async function enableNetworkThrottling(page) {
    console.log('Enabling low bandwidth throttling...');
    const client = await page.target().createCDPSession();
    await client.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: 100 * 1024 / 8, // 100 kbps
        uploadThroughput: 100 * 1024 / 8,   // 100 kbps
        latency: 500,                      // 500 ms
    });
    console.log('Low bandwidth throttling enabled.');
}

// Set YouTube video quality to the lowest
async function setLowestVideoQuality(page, sessionId) {
    // Open the settings menu and select the lowest video quality
    await page.evaluate(() => {
        // Open the settings menu
        const settingsButton = document.querySelector('.ytp-settings-button');
        if (settingsButton) {
            settingsButton.click();
        } else {
            console.log(`Session ${sessionId}: Settings button not found.`);
            return;
        }

        // Function to delay execution
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        // Wait for the Quality option and select it
        delay(500).then(() => async () => {
            const qualityMenuItem = Array.from(document.querySelectorAll('.ytp-menuitem'))
                .find((el) => el.textContent.trim() === 'Quality');
            if (qualityMenuItem) {
                qualityMenuItem.click();
            } else {
                console.log('Quality menu item not found.');
                await takeScreenshot(page, `${sessionId}-error-setLowestVideoQuality.png`);
                return;
            }

            // Wait for the quality options to load and select the lowest quality
            delay(500).then(() => async () => {
                const qualityOptions = Array.from(document.querySelectorAll('.ytp-menuitem'));
                if (qualityOptions.length > 0) {
                    // Select the last option in the list (lowest quality)
                    qualityOptions[qualityOptions.length - 1].click();
                    console.log('Lowest video quality selected.');
                } else {
                    console.log('Quality options not found.');
                    await takeScreenshot(page, `${sessionId}-error-setLowestVideoQuality.png`);
                }
            });
        });
    });
}

async function checkForSignInPrompt(page, browser) {
    console.log('Checking for "Sign in to confirm you’re not a bot" prompt...');
    try {
        // Look for the message on the page
        const signInPrompt = await page.$x("//yt-formatted-string[contains(text(), 'Sign in to confirm you’re not a bot')]");
        if (signInPrompt.length > 0) {
            console.log('Detected "Sign in to confirm you’re not a bot" prompt. Closing browser.');
            await browser.close(); // Close the browser
            return true;
        }
    } catch (error) {
        console.error('Error checking for sign-in prompt:', error.message);
    }
    return false;
}

async function ensureVideoPlaying(page, sessionId) {
    // Check if the play button is in "Pause" state
    const isPaused = await page.evaluate(() => {
        const playButton = document.querySelector('.ytp-play-button');
        return playButton?.getAttribute('data-title-no-tooltip') === 'Pause';
    });

    // If not in "Pause" state, click the button to play the video
    if (!isPaused) {
        console.log(`Session ${sessionId}: Video is not playing. Clicking the play button to start the video.`);
        const playButton = await page.$('.ytp-play-button'); // Select the play button
        if (playButton) {
            await playButton.click(); // Click the button
        } else {
            console.log(`Session ${sessionId}: Play button not found.`);
        }
    } else {
        console.log(`Session ${sessionId}: Video is already playing.`);
    }
}

async function clickRejectAllButtonIfExists(page) {
    const rejectAllButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(button => button.textContent.trim() === 'Reject all');
    });

    if (rejectAllButton) {
        console.log('The "Reject all" button is present. Clicking it.');
        await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button'))
                .find(button => button.textContent.trim() === 'Reject all');
            button.click();
        });
    } else {
        console.log('The "Reject all" button is not present.');
    }
}

async function automateYouTube(torInstance, sessionId) {
    console.log(`Session ${sessionId}: Starting YouTube automation`);

    // Request a unique Tor IP
    const newIp = await requestUniqueTorIp(torInstance, sessionId);
    console.log(`Session ${sessionId}: Using unique Tor IP: ${newIp}`);

    // Launch Puppeteer with Tor proxy
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            `--proxy-server=socks5://${TOR_HOST}:${torInstance.proxyPort}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Avoid detection as automation
        ],
    });

    const page = await browser.newPage();

    try {
        // Set a random user-agent
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
        ];
        await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

        let headers = {
            'Referer': faker.internet.url(),
            'Origin': faker.internet.url(),
        };
        // console.log(headers);        
        // await page.setExtraHTTPHeaders(headers);

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // Open YouTube channel
        console.log(`Session ${sessionId}: Opening YouTube Video`);
        await page.goto(YOUTUBE_URL, { waitUntil: 'domcontentloaded' });

        // Detect and click the "Reject all" button if it exists
        await clickRejectAllButtonIfExists(page);

        // Check for sign-in prompt
        const isSignInRequired = await checkForSignInPrompt(page, browser);
        if (isSignInRequired) return;

        // Handle ads (if any)
        if (await page.$('.ytp-ad-skip-button')) {
            console.log('Ad detected. Skipping...');
            await page.click('.ytp-ad-skip-button');
            await page.waitForTimeout(1000); // Wait for the video to start
        }

        // Wait for the play button to appear
        await page.waitForSelector('.ytp-play-button', { timeout: 10000 });

        await setLowestVideoQuality(page, sessionId);

        // Ensure the video is playing
        await ensureVideoPlaying(page, sessionId);

        // Simulate interaction for 30 seconds
        console.log(`Session ${sessionId}: Watching video for 30 seconds`);
        for (let i = 0; i < 7; i++) {
            try {
                await page.mouse.move(Math.random() * 1000, Math.random() * 800, { steps: 10 });

                // Scroll the page every 10 seconds
                if (i % 3 === 0 && i !== 0) {
                    console.log(`Session ${sessionId}: Scrolling page at iteration ${i}`);
                    await page.evaluate(() => window.scrollBy(0, 100));
                }

                // Enable network throttling at the beginning
                if (i === 5) {
                    // console.log(`Session ${sessionId}: Enabling network throttling`);
                    // await enableNetworkThrottling(page);
                }

                // Log progress every 5 seconds
                console.log(`Session ${sessionId}: Simulating interaction, iteration ${i + 1}`);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
            } catch (error) {
                console.error(`Session ${sessionId}: Error during interaction simulation at iteration ${i + 1}: ${error.message}`);
                break; // Exit loop if an error occurs
            }
        }

        console.log(`Session ${sessionId}: Finished watching video.`);

    } catch (err) {
        console.error(`Session ${sessionId}: Error: ${err.message}`);
    } finally {
        // save screenshot
        await takeScreenshot(page, `screenshot-${sessionId}.png`);
        console.log(`Session ${sessionId}: Screenshot saved.`);

        await browser.close();
        console.log(`Session ${sessionId}: Closed browser`);
    }
}

// Automate YouTube interaction with Puppeteer
async function automateYouTubeChannel(torInstance, sessionId) {
    console.log(`Session ${sessionId}: Starting YouTube automation`);

    // Request a unique Tor IP
    const newIp = await requestUniqueTorIp(torInstance, sessionId);

    // Launch Puppeteer with Tor proxy
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            `--proxy-server=socks5://${TOR_HOST}:${torInstance.proxyPort}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Avoid detection as automation
        ],
    });

    const page = await browser.newPage();

    try {
        // Set a random user-agent
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36',
        ];
        await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // Open YouTube channel
        console.log(`Session ${sessionId}: Opening YouTube channel`);
        await page.goto(YOUTUBE_CHANNEL_URL, { waitUntil: 'networkidle2' });

        // Handle cookie consent
        try {
            console.log(`Session ${sessionId}: Checking for "Reject all" button`);
            // Wait for the "Reject all" button to appear
            const rejectButton = await page.waitForSelector('button[aria-label="Reject all"]', {
                timeout: 10000, // Wait up to 10 seconds
                visible: true, // Ensure the button is visible
            });

            if (rejectButton) {
                console.log(`Session ${sessionId}: Found "Reject all" button, attempting to click`);
                // Simulate mouse movements
                await page.mouse.move(Math.random() * 1000, Math.random() * 800, { steps: 10 });
                await rejectButton.click(); // Click the button
                console.log(`Session ${sessionId}: "Reject all" button clicked successfully.`);
            } else {
                console.log(`Session ${sessionId}: "Reject all" button not found.`);
            }
        } catch (error) {
            console.log(`Session ${sessionId}: Error handling cookie consent: ${error.message}`);
        }

        // Click the LIVE tab
        console.log(`Session ${sessionId}: Clicking the LIVE tab`);

        try {
            // Wait for the LIVE tab to appear
            const liveTab = await page.waitForSelector(
                'xpath///yt-tab-shape[@tab-title="Live"]',
                { timeout: 20000, visible: true } // Wait longer and ensure visibility
            );

            if (liveTab) {
                // Simulate mouse movements
                await page.mouse.move(Math.random() * 1000, Math.random() * 800, { steps: 10 });
                await liveTab.click();
                console.log(`Session ${sessionId}: Clicked the LIVE tab.`);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for the tab content to load
            } else {
                console.log(`Session ${sessionId}: LIVE tab not found.`);
            }
        } catch (error) {
            console.log(`Session ${sessionId}: Failed to click the LIVE tab. Error: ${error.message}`);
        }

        // Click the first live video
        console.log(`Session ${sessionId}: Clicking the first live video`);
        const firstLiveVideo = await page.waitForSelector(
            'xpath///a[@id="thumbnail" and .//span[contains(text(), "LIVE")]]',
            { timeout: 20000 }
        );
        if (firstLiveVideo) {
            // Simulate mouse movements
            await page.mouse.move(Math.random() * 1000, Math.random() * 800, { steps: 10 });
            await firstLiveVideo.click();
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for the video to load
        }


        // Check for sign-in prompt
        const isSignInRequired = await checkForSignInPrompt(page, browser);
        if (isSignInRequired) return;

        // Wait for the YouTube player to load
        await page.waitForSelector('video');

        // Simulate interaction for 30 seconds
        console.log(`Session ${sessionId}: Watching video for 30 seconds`);
        for (let i = 0; i < 72; i++) {
            if (i > 3) {
                // await page.evaluate(() => window.scrollBy(0, 100));
            }
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
            if (i == 0) {
                await enableNetworkThrottling(page);
            }
            if (i == 1) {
                await setLowestVideoQuality(page);
            }
        }
    } catch (err) {
        console.error(`Session ${sessionId}: Error: ${err.message}`);
    } finally {
        // save screenshot
        await takeScreenshot(page, `screenshot-${sessionId}.png`);
        console.log(`Session ${sessionId}: Screenshot saved.`);

        await browser.close();
        console.log(`Session ${sessionId}: Closed browser`);
    }
}

async function takeScreenshot(page, filename) {
    if (!page.isClosed()) {
        try {
            await page.screenshot({ path: 'screenshots/' + filename });
        } catch (error) {
            console.error('Screenshot failed:', error.message);
        }
    } else {
        console.error('Cannot take screenshot, page is closed.');
    }
}

// Start sessions with a 5-second delay between each
(async () => {
    // loop through the number of reruns
    for (let idx_rerun = 0; idx_rerun < RERUN_TIMES; idx_rerun++) {

        let sessionPromises = []; // To track session promises

        for (let index = 0; index < torInstances.length; index++) {
            console.log(`Starting session ${index + 1}`);
            // Start the session without waiting
            const sessionPromise = automateYouTube(torInstances[index], index + 1);
            sessionPromises.push(sessionPromise);

            // Introduce a 5-second delay before starting the next session
            if (index < torInstances.length - 1) {
                console.log('Waiting 10 seconds before starting the next session...');
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5-second delay
            }
        }

        try {
            // Wait for all sessions to complete
            await Promise.all(sessionPromises);
            console.log(idx_rerun + ': ' + torInstances.length + ' sessions completed.');
        } catch (err) {
            console.error('Error running sessions:', err.message);
        }
    };
})();