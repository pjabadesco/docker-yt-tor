const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Add Stealth Plugin to Puppeteer Extra
puppeteer.use(StealthPlugin());

// Configuration
const PROXY_LIST_URL = [
    'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text'
];
const YOUTUBE_URL = process.env.YOUTUBE_URL?.trim() || 'https://www.youtube.com/watch?v=BPydARoYxa4';
const RERUN_TIMES = Math.max(Number(process.env.RERUN_TIMES) || 10, 1);
const WATCH_TIME_SEC = Math.max(Number(process.env.WATCH_TIME_SEC) || 50, 30);
const WORKERS = Math.max(Number(process.env.WORKERS) || 10, 1);

let proxyList = [];

// Fetch Proxies
async function fetchProxies() {
    try {
        for (const url of PROXY_LIST_URL) {
            console.log(`Fetching proxies from: ${url}`);
            const response = await axios.get(url);
            const proxies = response.data.split('\n').filter(proxy => proxy.trim() !== '');
            proxyList.push(...proxies);
        }
        proxyList = [...new Set(proxyList)];
        console.log(`Fetched ${proxyList.length} unique proxies.`);
    } catch (error) {
        console.error('Error fetching proxies:', error.message);
    }
}

// Fetch Proxies from Local File
async function fetchProxiesFromFile() {
    try {
        const filePath = path.join(__dirname, 'proxy.txt');
        const data = fs.readFileSync(filePath, 'utf8');
        const proxies = data.split('\n').filter(proxy => proxy.trim() !== '');
        proxyList.push(...proxies);
        proxyList = [...new Set(proxyList)];
        console.log(`Fetched ${proxyList.length} unique proxies from file.`);
    } catch (error) {
        console.error('Error fetching proxies from file:', error.message);
    }
}

async function validateProxy(proxy, testUrl = 'https://www.youtube.com') {
    let protocol = 'http'; // Default protocol
    let ip, port;

    // Parse the proxy format
    if (proxy.includes('://')) {
        [protocol, proxy] = proxy.split('://');
    }

    [ip, port] = proxy.split(':');

    if (!ip || !port) {
        // console.error(`Invalid proxy format: ${proxy}`);
        return false;
    }

    try {
        const response = await axios.get(testUrl, {
            proxy: {
                protocol,
                host: ip,
                port: parseInt(port, 10),
            },
            timeout: 5000, // 5-second timeout for proxy validation
        });

        if (response.status === 200) {
            console.log(`Valid proxy: ${protocol}://${ip}:${port}`);
            return true;
        }
    } catch (error) {
        // if (error.code === 'ENOTFOUND') {
        //     console.error(`Invalid proxy: ${protocol}://${ip}:${port}: DNS resolution failed.`);
        // } else if (error.message.includes('protocol mismatch')) {
        //     console.error(`Invalid proxy: ${protocol}://${ip}:${port}: Protocol mismatch.`);
        // } else {
        //     console.error(`Invalid proxy: ${protocol}://${ip}:${port}:`, error.message);
        // }
        return false;
    }
    return false;
}

// Get Valid Proxy
async function getValidProxy() {
    while (proxyList.length > 0) {
        const randomIndex = Math.floor(Math.random() * proxyList.length);
        const proxy = proxyList[randomIndex];
        const validIp = await validateProxy(proxy);
        if (validIp) {
            console.log(`Valid proxy: ${proxy} (IP: ${validIp})`);
            return proxy;
        } else {
            // console.log(`Invalid proxy: ${proxy}`);
            proxyList.splice(randomIndex, 1); // Remove invalid proxy
        }
    }
    throw new Error('No valid proxies available.');
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
        console.error(`WORKER ${workerId}: Error checking for sign-in prompt:`, error.message);
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

// Automate YouTube Session
async function automateYouTube(workerId) {
    console.log(`WORKER ${workerId}: Starting automation.`);

    let proxy;
    try {
        proxy = await getValidProxy();
    } catch (error) {
        console.error(`WORKER ${workerId}: No valid proxies. Skipping.`);
        return;
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            `--proxy-server=${proxy}`,
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Avoid detection as automation
        ],
        protocolTimeout: 60000, // Increase to 60 seconds (or longer if needed)
        timeout: 60000, // Increase timeout to 60 seconds
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000); // Set default navigation timeout to 60 seconds
    await page.setDefaultTimeout(60000); // Set default action timeout to 60 seconds    

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
        console.log(`WORKER ${workerId}: Opening YouTube Video`);
        await page.goto(YOUTUBE_URL, { waitUntil: 'domcontentloaded' });

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

            console.log(`WORKER ${workerId}: Watching video for ${WATCH_TIME_SEC} seconds`);
            for (var i = 0; i < Math.floor(WATCH_TIME_SEC / 5); i++) {
                try {
                    // Scroll the page every 3 seconds
                    if (i % 3 === 0 && i !== 0) {
                        await page.mouse.move(Math.random() * 1000, Math.random() * 800, { steps: 10 });
                        await page.evaluate(() => window.scrollBy(0, 100));
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

// Main function to start sessions
(async () => {
    deleteScreenshots(); // Delete existing screenshots
    console.log('Starting proxy-based YouTube automation...');
    // await fetchProxiesFromFile();
    await fetchProxies();

    for (let rerun = 0; rerun < RERUN_TIMES; rerun++) {
        console.log(`Rerun ${rerun + 1}/${RERUN_TIMES}`);
        const sessionPromises = [];
        for (let workerId = 1; workerId <= WORKERS; workerId++) {
            sessionPromises.push(automateYouTube(workerId));
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5-second delay between sessions
        }
        await Promise.all(sessionPromises);
    }
})();
