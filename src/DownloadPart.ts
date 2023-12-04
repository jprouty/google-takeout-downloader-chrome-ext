export type DownloadPart = {
    // From the initial parse of the export list:
    part: number;
    parts: number;
    url: string;
    size: number;

    // Updated during the life of the download:
    downloadId?: number;
    state?: string;
    error?: string;
    canPause?: boolean;
    isPaused?: boolean;
    bytesReceived?: number;
};
