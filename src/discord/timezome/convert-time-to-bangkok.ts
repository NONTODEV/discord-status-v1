import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export function convertUtcToBangkok(utcDate: string): string {
    return dayjs(utcDate).tz('Asia/Bangkok').format('YYYY-MM-DD HH:mm:ss');
}