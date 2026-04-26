import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

class WebAutomation {
    static DEFAULT_NAVIGATION_TIMEOUT = 10000;
    static DEFAULT_SELECTOR_TIMEOUT = 1000;
    static DEFAULT_COOKIE_TIMEOUT = 1000;
    static INITIAL_WAIT_TIME = 2000;
    static DEFAULT_MAX_RETRIES = 10;

    constructor(options = {}) {
        this.browser = null;
        this.page = null;
        this.context = null;
        this.options = {
            headless: true,
            ...options
        };
    }

    async launch() {
        this.browser = await chromium.launch({ headless: this.options.headless });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async goTo(url) {
        if (!this.page) {
            throw new Error("Page is not initialized. Call launch() first.");
        }
        await this.page.goto(url, { timeout: WebAutomation.DEFAULT_NAVIGATION_TIMEOUT, waitUntil: 'domcontentloaded' });
    }

    async getAttribute(selector, attribute) {
        if (!this.page) {
            throw new Error("Page is not initialized. Call launch() first.");
        }
        const element = await this.page.waitForSelector(selector, { timeout: WebAutomation.DEFAULT_SELECTOR_TIMEOUT, state: 'visible' });
        return await element.getAttribute(attribute);
    }

    async getAllAttributes(selector, attribute) {
        if (!this.page) {
            throw new Error("Page is not initialized. Call launch() first.");
        }
        await this.page.waitForSelector(selector, { timeout: WebAutomation.DEFAULT_SELECTOR_TIMEOUT, state: 'visible' });
        const elements = await this.page.$$(selector);
        const attributes = [];
        for (const element of elements) {
            const attr = await element.getAttribute(attribute);
            if (attr) {
                attributes.push(attr);
            }
        }
        return attributes;
    }

    async downloadImage(url, savePath, fileName) {
        if (!this.page) {
            throw new Error("Page is not initialized. Call launch() first.");
        }
        const viewSource = await this.page.goto(url);
        const buffer = await viewSource.buffer();
        await fs.mkdir(savePath, { recursive: true });
        await fs.writeFile(path.join(savePath, fileName), buffer);
    }
}

export default WebAutomation;