export const sizeAsBytes = (size: number, unit: string): number => {
    let unitMulti = 1;
    switch (unit) {
        case 'KB':
            unitMulti = 1024;
            break;
        case 'MB':
            unitMulti = 1024 * 1024;
            break;
        case 'GB':
            unitMulti = 1024 * 1024 * 1024;
            break;
        case 'TB':
            unitMulti = 1024 * 1024 * 1024 * 1024;
            break;
        default:
            unitMulti = 1;
            break;
    }
    return size * unitMulti;
};

export const prettySize = (size: number): string => {
    let numDivisions = 0;
    while (size > 1024) {
        size = size / 1024;
        numDivisions++;
    }
    return `${size.toFixed(2)} ${getUnit(numDivisions)}`;
}

const getUnit = (numDivisions: number): string => {
    switch (numDivisions) {
        case 0:
            return 'B';
        case 1:
            return 'KB';
        case 2:
            return 'MB';
        case 3:
            return 'GB';
        case 4:
            return 'TB';
        case 5:
            return 'PB';
        default:
            return '?B';
    }
}