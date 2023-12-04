import { DownloadPart } from '../DownloadPart'
import { prettySize } from '../sizeUtils'

const takeoutFinalUrlRe = new RegExp(/googleusercontent\.com\/download\/storage\/v1\/b\/dataliberation\/o\/(?<timestamp>\d{8}T\d{6})\.\d{3}Z/g);
const takeoutFilenameRe = new RegExp(/-(?<part>\d{3})\./g);

// BUG: Filename of drive files that exceed the download part size selection will come raw dawg, like an mp4.
// Must match ahead of time at download creation time, based on the takeoutFinalUrlRe.

// Look for the newly initiated download and grab the timestamp prefix.
const onDlCreated = async (dlItem: chrome.downloads.DownloadItem): Promise<void> => {
    // console.log("downloads.onCreated", dlItem);
    for (const match of dlItem.finalUrl.matchAll(takeoutFinalUrlRe)) {
        let downloads = await chrome.storage.local.get();

        if (!match.groups) continue;
        if (!downloads.batchTimestamp) {
            console.log(`New takeout batch timestamp: ${match.groups.timestamp}`);
            downloads.batchTimestamp = match.groups.timestamp;
            downloads.downloadIdToPartIdx = {};
        } else {
            if (downloads.batchTimestamp !== match.groups.timestamp) {
                console.warn(`Takeout download started but from different export with batch timestamp: ${match.groups.timestamp}`);
                return;
            }
        }
        // Insert a null placeholder, indicating that a download has started but the filename is not yet determined and therefore the part # is unknown at this point.
        downloads.downloadIdToPartIdx[dlItem.id] = null;
        await chrome.storage.local.set(downloads);
    }
};

const onDlChanged = async (delta: chrome.downloads.DownloadDelta): Promise<void> => {
    // console.log('onChanged', delta);
    let downloads = await chrome.storage.local.get();
    // Only pay attention to downloads that are part of this batch, as determined via onDlCreated.
    if (!(delta.id in downloads.downloadIdToPartIdx)) return;

    // Filename delta, which happens once the download starts:
    if (delta.filename && delta.filename.current) {
        for (const match of delta.filename.current.matchAll(takeoutFilenameRe)) {
            if (!match.groups) continue;
            console.log(`Part ${match.groups.part} started`);
            // Associate the download id with the part.
            const partIdx = parseInt(match.groups.part) - 1;
            downloads.parts[partIdx].downloadId = delta.id;
            downloads.parts[partIdx].state = "in_progress";
            downloads.isDownloading = true;
            downloads.downloadIdToPartIdx[delta.id] = partIdx;
            // Download is established - eliminate the cool down.
            downloads.coolDown = 0;
            break;
        }
    }

    // Sometimes the download is a duplicate/doesn't match the filename filter. Drop out here if that's the case.
    if (downloads.downloadIdToPartIdx[delta.id] === null) return;

    const partIdx = downloads.downloadIdToPartIdx[delta.id];
    // State delta: Look for downloads that are finishing.
    if (delta.state) {
        // Regardless of what the state is, update the state on the part.
        downloads.parts[partIdx].state = delta.state.current;
        if (delta.state.current === "complete") {
            console.log(`Part ${partIdx + 1} complete.`)
            // Remove the completed download form the active set of downloads.
            delete downloads.downloadIdToPartIdx[delta.id];
        }
    }

    if (delta.error) downloads.parts[partIdx].error = delta.error.current;
    if (delta.canResume) downloads.parts[partIdx].canResume = delta.canResume.current;
    if (delta.paused) downloads.parts[partIdx].paused = delta.paused.current;

    return await chrome.storage.local.set(downloads);
    // TODO: Look for other failure states.
};

// Look for the newly initiated download and grab the timestamp prefix.
chrome.downloads.onCreated.addListener(onDlCreated);
chrome.downloads.onChanged.addListener(onDlChanged);

const startDownload = async (request: any, sender: chrome.runtime.MessageSender): Promise<any> => {
    console.log('startDownload');
    await chrome.sidePanel.open({ tabId: sender.tab?.id});
    return {
        success: true,
        startNextDownloadUrl: null,
    };

    // await chrome.storage.local.set({
    //     isDownloading: true,
    //     parts: request.downloads,
    //     coolDown: 60,
    //     downloadIdToPartIdx: {},
    // });

    // return {
    //     success: true,
    //     startNextDownloadUrl: request.downloads[0].url,
    // };
}

const downloadStatus = async (request: any): Promise<any> => {
    let downloads = await chrome.storage.local.get();
    if (!downloads.parts) return { isDownloading: false };

    await updateDownloadProgress(downloads);

    const totalDownloaded = downloads.parts.map(e => getDownloadedSize(e)).reduce((a, b) => a + b);
    const totalDownloadSize = downloads.parts.map(e => e.size).reduce((a, b) => a + b);

    const inProgressDownloads = downloads.parts.filter(e => e.state === "in_progress");

    let partProgress = '';
    for (const part of inProgressDownloads) {
        partProgress += `<br>Part ${part.part} ${(part.bytesReceived * 100 / part.size).toFixed(1)}% ${prettySize(part.bytesReceived)} / ${prettySize(part.size)}`;
    }

    const statusData = {
        statusString: `Bulk download in progress.<br><br><strong>Keep this dialog open!</strong><br><br><strong>Overall ${(totalDownloaded * 100 / totalDownloadSize).toFixed(2)}% ${prettySize(totalDownloaded)} / ${prettySize(totalDownloadSize)}</strong>${partProgress}`,
        isDownloading: !!downloads.isDownloading,
        startNextDownloadUrl: downloads.coolDown-- > 0 ? null : await getNextDownloadUrl(downloads.parts),
    };
    if (statusData.startNextDownloadUrl) downloads.coolDown = 60;
    await chrome.storage.local.set(downloads);
    return statusData;
}

const updateDownloadProgress = async (downloads: any): Promise<any> => {
    let numUpdated = 0;
    for (const part of downloads.parts) {
        if (part.state && part.state === "in_progress") {
            const d = await chrome.downloads.search({ id: part.downloadId });
            if (d.length === 1) {
                part.bytesReceived = d[0].bytesReceived;
                if (d[0].state === "complete" || d[0].bytesReceived === d[0].totalBytes) {
                    part.state = "complete";
                    delete downloads.downloadIdToPartIdx[part.downloadId];
                } else if (d[0].state !== "in_progress") {
                    delete part.state;
                    delete part.downloadId;
                    delete part.bytesReceived;
                    delete downloads.downloadIdToPartIdx[part.downloadId];
                }
                numUpdated++;
            } else {
                delete part.state;
                delete part.downloadId;
                delete part.bytesReceived;
                delete downloads.downloadIdToPartIdx[part.downloadId];
            }
        }
    }
    return numUpdated !== 0;
}

// Chrome has a max of 10 concurrent connections (personally verified to be the case on win11 and macOS 14).
// Max out at 9, leaving one connection left.
// https://bluetriangle.com/blog/blocking-web-performance-villain#:~:text=Chrome%20has%20a%20limit%20of,host%20at%20the%20same%20time.
const MAX_CONCURRENT_DOWNLOADS = 9;

const getNextDownloadUrl = async (parts: DownloadPart[]): Promise<any> => {
    const inProgressDownloads = parts.filter(e => e.state === "in_progress");
    const numInProgress = inProgressDownloads.length;

    if (numInProgress >= MAX_CONCURRENT_DOWNLOADS) return null;
    return getNextPartUrl(parts);
    // if (numInProgress === 0) return getNextPartUrl(parts);

    // // Both for in_progress only:
    // const totalDownloadSize = inProgressDownloads.map(e => e.size).reduce((a, b) => a + b);
    // const totalDownloadedSize = inProgressDownloads.map(e => e.bytesReceived).reduce((a, b) => a + b);

    // // Don't saturate MAX_CONCURRENT_DOWNLOADS right away. Instead, attempt to stagger the downloads such that they are starting/ending as evenly as possible, assuming this will help to stay authed.
    // const partLoad = numInProgress / MAX_CONCURRENT_DOWNLOADS;

    // if (totalDownloadedSize / totalDownloadSize < partLoad) return null;
    // return getNextPartUrl(parts);
};

const getNextPartUrl = (parts: DownloadPart[]): string | null => {
    const nextPart = parts.find((part: DownloadPart) => !part.downloadId);
    if (!nextPart) return null;
    console.log(`Selecting part ${nextPart.part} for next fetch (${nextPart.parts} parts total)`);
    return nextPart.url;
}

const getDownloadedSize = (part: DownloadPart): number => {
    if (part.state && part.state === "complete") return part.size;
    if (part.state && part.state === "in_progress") return part.bytesReceived!;
    return 0;
}

// Return true to indicate an asynchronous response.
chrome.runtime.onMessage.addListener(
    (request, sender, sendResponse) => {
        if (request.action === "START_BULK_DL") {
            startDownload(request, sender).then(sendResponse);
            return true;
        } else if (request.action === "BULK_DL_STATUS") {
            downloadStatus(request).then(sendResponse);
            return true;
        }
        console.warn(`Unrecognized message action: ${request.action}`);
        return false;
    }
);