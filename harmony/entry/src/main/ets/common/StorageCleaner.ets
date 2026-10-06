import fs from '@ohos.file.fs';

// 网页“存储与缓存”页用到的原生部分：ArkWeb 的网络缓存和临时文件。
// 网页自己能清的（Cache Storage、页面数据缓存）不在这里；登录状态、课表缓存、
// 卡片数据和课表背景放在 files、preferences 和 ArkWeb 的站点数据里，这里从不触碰。

export const STORAGE_NETWORK: string = 'network';
export const STORAGE_TEMP: string = 'temp';

/**
 * ArkWeb 的整个站点数据都在应用缓存目录的 web 子目录里，包括 Local Storage、IndexedDB、
 * Service Worker 等登录和离线数据，所以这个目录从不直接删除。
 */
const WEB_DIRECTORY: string = 'web';
/** 其中属于网络缓存的部分，由 WebviewController.removeCache 清理，这里只统计大小。 */
const WEB_CACHE_DIRECTORIES: string[] = ['Cache', 'Code Cache'];

interface StorageCategory {
  id: string;
  bytes: number;
}

interface StorageUsage {
  categories: StorageCategory[];
  totalBytes: number;
}

export interface StorageDirectories {
  /** 应用级缓存目录（/data/storage/el2/base/cache），ArkWeb 的数据在其 web 子目录。 */
  cacheDir: string;
  /** 应用级和模块级的临时目录、模块级缓存目录。 */
  tempDirs: string[];
  /** 计入“应用数据”总量的根目录。 */
  dataDirs: string[];
}

/** 目录不存在或无权读取时按 0 计。 */
export function directorySize(path: string): number {
  let total = 0;
  let names: string[] = [];
  try {
    names = fs.listFileSync(path);
  } catch (_) {
    return 0;
  }
  names.forEach((name: string) => {
    const child = path + '/' + name;
    try {
      const stat = fs.lstatSync(child);
      if (stat.isDirectory()) total += directorySize(child);
      else if (stat.isFile()) total += stat.size;
    } catch (_) {
      // 统计期间被删除或无权访问的文件直接跳过。
    }
  });
  return total;
}

function clearDirectory(path: string, keep: string[]): void {
  let names: string[] = [];
  try {
    names = fs.listFileSync(path);
  } catch (_) {
    return;
  }
  names.forEach((name: string) => {
    if (keep.indexOf(name) >= 0) return;
    const child = path + '/' + name;
    try {
      if (fs.lstatSync(child).isDirectory()) fs.rmdirSync(child);
      else fs.unlinkSync(child);
    } catch (_) {
      // 正在使用的文件留到下次清理。
    }
  });
}

function networkBytes(directories: StorageDirectories): number {
  let total = 0;
  WEB_CACHE_DIRECTORIES.forEach((name: string) => {
    total += directorySize(directories.cacheDir + '/' + WEB_DIRECTORY + '/' + name);
  });
  return total;
}

function temporaryBytes(directories: StorageDirectories): number {
  let total = Math.max(0, directorySize(directories.cacheDir) - directorySize(directories.cacheDir + '/' + WEB_DIRECTORY));
  directories.tempDirs.forEach((path: string) => { total += directorySize(path); });
  return total;
}

export function storageUsageJson(directories: StorageDirectories): string {
  let total = 0;
  directories.dataDirs.forEach((path: string) => { total += directorySize(path); });
  const usage: StorageUsage = {
    categories: [
      { id: STORAGE_NETWORK, bytes: networkBytes(directories) },
      { id: STORAGE_TEMP, bytes: temporaryBytes(directories) }
    ],
    totalBytes: total
  };
  return JSON.stringify(usage);
}

/** 只接受分类名的 JSON 数组；无法识别时什么都不清。 */
export function parseStorageCategories(raw: string): string[] {
  try {
    const values = JSON.parse(raw ?? '[]') as string[];
    return Array.isArray(values) ? values.filter((value: string) => typeof value === 'string') : [];
  } catch (_) {
    return [];
  }
}

export function clearTemporaryFiles(directories: StorageDirectories): void {
  clearDirectory(directories.cacheDir, [WEB_DIRECTORY]);
  directories.tempDirs.forEach((path: string) => clearDirectory(path, []));
}
