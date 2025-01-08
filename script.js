const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const TorControl = require('tor-control');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
// const { faker } = require('@faker-js/faker');

// Add the stealth plugin to Puppeteer Extra
puppeteer.use(StealthPlugin());

// Configuration
const TOR_HOST = process.env.TOR_HOST?.trim() || '192.168.100.171'; // Tor service host
const TOR_CONTROL_BASE_PORT = Number(process.env.TOR_CONTROL_BASE_PORT) || 7001; // Tor control port
const TOR_PROXY_BASE_PORT = Number(process.env.TOR_PROXY_BASE_PORT) || 9001; // Base Tor proxy port
const TOR_CONTROL_PASSWORD = process.env.TOR_CONTROL_PASSWORD?.trim() || 'abadesco'; // Tor control password
const YOUTUBE_CHANNEL_URL = process.env.YOUTUBE_CHANNEL_URL?.trim() || 'https://www.youtube.com/@WION'; // Default YouTube channel URL
const YOUTUBE_URL = process.env.YOUTUBE_URL?.trim() || 'https://www.youtube.com/watch?v=BPydARoYxa4'; // Default YouTube video URL
const RERUN_TIMES = Math.max(Number(process.env.RERUN_TIMES) || 5, 1); // Number of reruns (minimum 1)
const TOR_POOL_SIZE = Math.max(Number(process.env.TOR_POOL_SIZE) || 5, 1); // Number of Tor instances in the pool (minimum 1)
const WATCH_TIME_SEC = Math.max(Number(process.env.WATCH_TIME_SEC) || 50, 30); // Watch time in seconds (minimum 10)

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
async function requestUniqueTorIp(torInstance, workerId) {
    let newIp;
    const maxRetries = 20; // Increased retries
    const retryDelay = 10000; // Delay in milliseconds

    for (let i = 0; i < maxRetries; i++) {
        await requestNewTorIdentity(torInstance, workerId);
        await new Promise(resolve => setTimeout(resolve, retryDelay)); // Add delay for IP change
        newIp = await getTorIp(torInstance, workerId);
        // newIp = workerId;

        if (!usedIps.has(newIp)) {
            usedIps.add(newIp); // Mark the IP as used globally
            console.log(`WORKER ${workerId}: Unique IP acquired: ${newIp}`);
            return newIp;
        } else {
            console.log(`WORKER ${workerId}: Duplicate IP detected (${newIp}). Retrying...`);
        }
    }

    console.warn(`WORKER ${workerId}: Unable to get a unique IP after ${maxRetries} retries. Proceeding with duplicate IP: ${newIp}`);
    return newIp; // Return the duplicate IP as a fallback
}

// Request a new Tor identity
function requestNewTorIdentity(torInstance, workerId) {
    return new Promise((resolve, reject) => {
        // console.log(`WORKER ${workerId}: Requesting new Tor identity.`);
        torInstance.control.signalNewnym((err) => {
            if (err) {
                console.error(`WORKER ${workerId}: Failed to request new Tor identity:`, err);
                reject(err);
            } else {
                console.log(`WORKER ${workerId}: New Tor identity requested.`);
                setTimeout(resolve, 5000); // Wait for the new identity to take effect
            }
        });
    });
}

// Get current Tor IP
async function getTorIp(torInstance, workerId) {
    try {
        // console.log(`WORKER ${workerId} ${torInstance.proxyPort}: Getting Tor IP...`);

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
        // console.log(`WORKER ${workerId}: Current Tor IP is ${torIp}`);
        return torIp;
    } catch (error) {
        // console.error(`WORKER ${workerId}: Failed to get Tor IP: ${error.message}`);
        return workerId + '.0.0.' + Math.floor(Math.random() * 254); // Return a default IP
    }
}

// Bypass Consent Popups
async function bypassConsent(page) {
    try {
        const consent = await page.evaluate(() => {
            const xpathResult = document.evaluate(
                "//button[@jsname='b3VHJd']",
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            return xpathResult.singleNodeValue;
        });
        if (consent) {
            await page.evaluate(el => el.click(), consent);
        }
    } catch (error) {
        console.error('Error bypassing consent:', error.message);
    }
}

// Handle Popups
async function bypassPopup(page) {
    try {
        const agree = await page.evaluate(() => {
            const xpathResult = document.evaluate(
                '//*[@aria-label="Agree to the use of cookies and other data for the purposes described"]',
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            return xpathResult.singleNodeValue;
        });
        if (agree) {
            await page.evaluate(el => el.click(), agree);
        }
    } catch (error) {
        console.error('Error bypassing popup:', error.message);
    }
}

// Handle Other Popups
async function bypassOtherPopup(page) {
    const popupLabels = ['Got it', 'Skip trial', 'No thanks', 'Dismiss', 'Not now'];

    for (const label of popupLabels) {
        try {
            const button = await page.evaluate(label => {
                const xpathResult = document.evaluate(
                    `//*[@id='button' and @aria-label='${label}']`,
                    document,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                );
                return xpathResult.singleNodeValue;
            }, label);

            if (button) {
                await page.evaluate(el => el.click(), button);
            }
        } catch (error) {
            console.error(`Error handling popup for label "${label}":`, error.message);
        }
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
async function setLowestVideoQuality(page, workerId) {
    // console.log(`WORKER ${workerId}: Setting lowest video quality...`);

    try {
        // Open the settings menu
        const settingsButton = await page.$('.ytp-settings-button');
        if (settingsButton) {
            await settingsButton.click();
        } else {
            console.log(`WORKER ${workerId}: Settings button not found.`);
            return;
        }

        // Wait for the settings menu to render
        await page.waitForSelector('.ytp-menuitem', { timeout: 5000 });

        // Debug all menu items
        const menuItems = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.ytp-menuitem')).map((el) => el.textContent.trim());
        });
        // console.log(`WORKER ${workerId}: Available menu items:`, menuItems);

        // Find and click the "Quality" menu item dynamically
        const qualityMenuItem = await page.evaluateHandle(() => {
            const items = Array.from(document.querySelectorAll('.ytp-menuitem'));
            return items.find((el) => el.textContent.trim().toLowerCase().includes('quality'));
        });

        if (qualityMenuItem) {
            // console.log(`WORKER ${workerId}: Clicking the Quality option...`);
            await qualityMenuItem.click();
        } else {
            console.log(`WORKER ${workerId}: Quality menu item not found.`);
            await takeScreenshot(page, `${workerId}-error-setLowestVideoQuality.png`);
            return;
        }

        // Wait for the quality options menu to render
        await page.waitForSelector('.ytp-panel-menu .ytp-menuitem', { timeout: 5000 });

        // Get all quality options, excluding "Auto"
        const qualityOptions = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.ytp-panel-menu .ytp-menuitem'))
                .map((el, index) => ({
                    text: el.textContent.trim(),
                    index: index,
                }))
                .filter(option => !option.text.toLowerCase().includes('auto')); // Exclude "Auto"
        });

        if (qualityOptions && qualityOptions.length > 0) {
            // console.log(`WORKER ${workerId}: Quality options available:`, qualityOptions);

            // Select the lowest quality option (last in the list)
            // console.log(`WORKER ${workerId}: Selecting the lowest video quality...`);
            await page.evaluate((options) => {
                const lowestQuality = options[options.length - 1];
                document.querySelectorAll('.ytp-panel-menu .ytp-menuitem')[lowestQuality.index].click();
            }, qualityOptions);
            // console log the value of the lowest quality selected
            console.log(`WORKER ${workerId}: Lowest video quality selected: ${qualityOptions[qualityOptions.length - 1].text}`);
        } else {
            console.log(`WORKER ${workerId}: Quality options not found.`);
            await takeScreenshot(page, `${workerId}-error-setLowestVideoQuality.png`);
        }
    } catch (error) {
        console.error(`WORKER ${workerId}: Error setting lowest video quality:`, error.message);
    }
}

async function checkForSignInPrompt(page, workerId) {
    try {
        // Wait for the container element that might house the prompt
        await page.waitForSelector('#reason', { timeout: 15000 });

        // Check for the "Sign in to confirm you're not a bot" message
        const signInPrompt = await page.evaluate(() => {
            const reasonElement = document.querySelector('#reason');
            if (reasonElement) {
                return reasonElement.textContent.includes("Sign in to confirm you’re not a bot");
            }
            return false;
        });

        if (signInPrompt) {
            console.log(`WORKER ${workerId}: Detected "Sign in to confirm you’re not a bot" message.`);
            return true;
        } else {
            console.log(`WORKER ${workerId}: No sign-in prompt detected in #reason.`);
        }
    } catch (error) {
        // console.error(`WORKER ${workerId}: Error checking for sign-in prompt:`, error.message);
    }
    return false;
}

async function checkifYoutubeVideoIsPlaying(page, workerId) {
    const isPlaying = await page.evaluate(() => {
        const playButton = document.querySelector('.ytp-play-button');
        const hasPause = playButton?.getAttribute('data-title-no-tooltip') === 'Pause';
        if (playButton && hasPause) {
            return true;
        } else {
            return false;
        }
    });
    return isPlaying;
}

async function ensureVideoPlaying(page, workerId) {
    await page.mouse.move(Math.random() * 1000, Math.random() * 800, { steps: 10 });
    // delay to wait for the video to start
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds

    // Check if the play button is in "Pause" state
    const isPlaying = await checkifYoutubeVideoIsPlaying(page, workerId);

    // If not in "Pause" state, click the button to play the video
    if (!isPlaying) {
        console.log(`WORKER ${workerId}: Video is not playing. Clicking the play button to start the video.`);

        // const playButton = await page.$('.ytp-play-button'); // Select the play button
        // if (playButton) {
        //     await playButton.click(); // Click the button
        // } else {
        //     console.log(`WORKER ${workerId}: Play button not found.`);
        // }

        await page.waitForSelector('.ytp-play-button', { visible: true });
        try {

            // close ads first
            await page.evaluate(() => {
                const overlay = document.querySelector('.ytp-ad-overlay-close-button');
                if (overlay) overlay.click();
            });

            await page.evaluate(() => {
                const playButton = document.querySelector('.ytp-play-button');
                if (playButton) playButton.click();
                // document.querySelector('.ytp-play-button').scrollIntoView();
            });
            // await page.click('.ytp-play-button');
            // console.log(`WORKER ${workerId}: Video is now playing.`);
        } catch (error) {
            console.error(`WORKER ${workerId}: Error clicking play button:`, error.message);
            // Retry with evaluate
            await page.evaluate(() => {
                document.querySelector('.ytp-play-button').click();
            });
        }
    } else {
        // console.log(`WORKER ${workerId}: Video is already playing.`);
    }
}

async function clickRejectAllButtonIfExists(page, workerId) {
    const rejectAllButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(button => button.textContent.trim() === 'Reject all');
    });

    if (rejectAllButton) {
        console.log(`WORKER ${workerId}: The "Reject all" button is present. Clicking it.`);
        await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button'))
                .find(button => button.textContent.trim() === 'Reject all');
            button.click();
        });
    } else {
        // console.log('The "Reject all" button is not present.');
    }
}

async function automateYouTube(torInstance, workerId) {
    console.log(`WORKER ${workerId}: Starting YouTube automation`);

    // Request a unique Tor IP
    try {
        const newIp = await requestUniqueTorIp(torInstance, workerId);
        console.log(`WORKER ${workerId}: New IP acquired: ${newIp}`);
    } catch (error) {
        console.error(`WORKER ${workerId}: Skipping due to Tor error:`, error.message);
        return; // Skip the session
    }

    // Launch Puppeteer with Tor proxy
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            `--proxy-server=socks5://${TOR_HOST}:${torInstance.proxyPort}`,
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Avoid detection as automation
        ],
        protocolTimeout: 60000, // Increase to 60 seconds (or longer if needed)
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

        // Enable dark mode
        await page.emulateMediaFeatures([
            { name: 'prefers-color-scheme', value: 'dark' },
        ]);

        // let headers = {
        //     'Referer': faker.internet.url(),
        //     'Origin': faker.internet.url(),
        // };
        // console.log(headers);
        // await page.setExtraHTTPHeaders(headers);

        // await page.evaluateOnNewDocument(() => {
        //     Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        //     // Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        //     // Object.defineProperty(navigator, 'plugins', {
        //     //     get: () => [1, 2, 3],
        //     // });
        // });

        // Open YouTube channel
        console.log(`WORKER ${workerId}: Opening YouTube Video`);
        await page.goto(YOUTUBE_URL, { waitUntil: 'domcontentloaded' });

        // // Detect and click the "Reject all" button if it exists
        // await clickRejectAllButtonIfExists(page, workerId);

        // // Handle ads (if any)
        // if (await page.$('.ytp-ad-skip-button')) {
        //     console.log('Ad detected. Skipping...');
        //     await page.click('.ytp-ad-skip-button');
        //     await page.waitForTimeout(1000); // Wait for the video to start
        // }

        await bypassConsent(page);
        await bypassPopup(page);
        await bypassOtherPopup(page);

        let isPlaying = await checkifYoutubeVideoIsPlaying(page, workerId);
        if (!isPlaying) {
            // Check for sign-in prompt
            const isSignInRequired = await checkForSignInPrompt(page, workerId);
            if (isSignInRequired) {
                console.log(`WORKER ${workerId}: Exiting due to sign-in prompt.`);
                return;
            }
            // Ensure the video is playing
            await ensureVideoPlaying(page, workerId);
        };

        isPlaying = await checkifYoutubeVideoIsPlaying(page, workerId);

        if (!isPlaying) {
            console.log(`WORKER ${workerId}: Video is not playing. Exiting...`);
        } else {
            await setLowestVideoQuality(page, workerId);

            // Simulate interaction for 30 seconds
            console.log(`WORKER ${workerId}: Watching video for ${WATCH_TIME_SEC} seconds`);
            for (var i = 0; i < Math.floor(WATCH_TIME_SEC / 5); i++) {
                try {
                    // Scroll the page every 10 seconds
                    if (i % 3 === 0 && i !== 0) {
                        await page.mouse.move(Math.random() * 1000, Math.random() * 800, { steps: 10 });
                        // console.log(`WORKER ${workerId}: Scrolling page at iteration ${i}`);
                        await page.evaluate(() => window.scrollBy(0, 100));
                    }

                    // Enable network throttling at the beginning
                    if (i === 5) {
                        // console.log(`WORKER ${workerId}: Enabling network throttling`);
                        // await enableNetworkThrottling(page);
                    }

                    // Log progress every 5 seconds
                    let progress = Math.ceil((i + 1) * 5 / WATCH_TIME_SEC * 100);
                    console.log(`WORKER ${workerId}: ${progress}%`);
                    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds
                } catch (error) {
                    console.error(`WORKER ${workerId}: Error during interaction simulation at iteration ${i + 1}: ${error.message}`);
                    break; // Exit loop if an error occurs
                }
            }

            console.log(`WORKER ${workerId}: TOTAL WATCH TIME: ${i * 5} seconds`);
        }

    } catch (err) {
        console.error(`WORKER ${workerId}: Error: ${err.message}`);
    } finally {
        // save screenshot
        await takeScreenshot(page, `screenshot-${workerId}.png`);
        console.log(`WORKER ${workerId}: Screenshot saved.`);

        await browser.close();
        console.log(`WORKER ${workerId}: Closed browser`);
    }
}

// Automate YouTube interaction with Puppeteer
async function automateYouTubeChannel(torInstance, workerId) {
    console.log(`WORKER ${workerId}: Starting YouTube automation`);

    // Request a unique Tor IP
    const newIp = await requestUniqueTorIp(torInstance, workerId);

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
        console.log(`WORKER ${workerId}: Opening YouTube channel`);
        await page.goto(YOUTUBE_CHANNEL_URL, { waitUntil: 'networkidle2' });

        // Handle cookie consent
        try {
            console.log(`WORKER ${workerId}: Checking for "Reject all" button`);
            // Wait for the "Reject all" button to appear
            const rejectButton = await page.waitForSelector('button[aria-label="Reject all"]', {
                timeout: 10000, // Wait up to 10 seconds
                visible: true, // Ensure the button is visible
            });

            if (rejectButton) {
                console.log(`WORKER ${workerId}: Found "Reject all" button, attempting to click`);
                // Simulate mouse movements
                await page.mouse.move(Math.random() * 1000, Math.random() * 800, { steps: 10 });
                await rejectButton.click(); // Click the button
                console.log(`WORKER ${workerId}: "Reject all" button clicked successfully.`);
            } else {
                console.log(`WORKER ${workerId}: "Reject all" button not found.`);
            }
        } catch (error) {
            console.log(`WORKER ${workerId}: Error handling cookie consent: ${error.message}`);
        }

        // Click the LIVE tab
        console.log(`WORKER ${workerId}: Clicking the LIVE tab`);

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
                console.log(`WORKER ${workerId}: Clicked the LIVE tab.`);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for the tab content to load
            } else {
                console.log(`WORKER ${workerId}: LIVE tab not found.`);
            }
        } catch (error) {
            console.log(`WORKER ${workerId}: Failed to click the LIVE tab. Error: ${error.message}`);
        }

        // Click the first live video
        console.log(`WORKER ${workerId}: Clicking the first live video`);
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
        console.log(`WORKER ${workerId}: Watching video for 30 seconds`);
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
        console.error(`WORKER ${workerId}: Error: ${err.message}`);
    } finally {
        // save screenshot
        await page.evaluate(() => {
            window.scrollTo(0, 0);
        });
        await takeScreenshot(page, `screenshot-${workerId}.png`);
        console.log(`WORKER ${workerId}: Screenshot saved.`);

        await browser.close();
        console.log(`WORKER ${workerId}: Closed browser`);
    }
}

async function takeScreenshot(page, filename) {
    if (!page.isClosed()) {
        try {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 seconds before the screenshot
            try {
                await page.screenshot({ path: `screenshots/${filename}` });
            } catch (error) {
                console.error('Screenshot failed:', error.message);
            }
        } catch (error) {
            console.error('Screenshot failed:', error.message);
        }
    } else {
        console.error('Cannot take screenshot, page is closed.');
    }
}

async function deleteScreenshots() {
    const fs = require('fs');
    const path = require('path');
    const directory = 'screenshots';

    fs.readdir(directory, (err, files) => {
        if (err) throw err;

        for (const file of files) {
            fs.unlink(path.join(directory, file), err => {
                if (err) throw err;
            });
        }
    });
}

// Start sessions with a 5-second delay between each
(async () => {
    deleteScreenshots(); // Delete existing screenshots
    // loop through the number of reruns
    for (let idx_rerun = 0; idx_rerun < RERUN_TIMES; idx_rerun++) {

        let sessionPromises = []; // To track session promises

        for (let index = 0; index < torInstances.length; index++) {
            // console.log(`Starting WORKER ${index + 1}`);
            // Start the session without waiting
            const sessionPromise = automateYouTube(torInstances[index], index + 1);
            sessionPromises.push(sessionPromise);

            // Introduce a 5-second delay before starting the next session
            if (index < torInstances.length - 1) {
                // console.log('Waiting 5 seconds before starting the next session...');
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