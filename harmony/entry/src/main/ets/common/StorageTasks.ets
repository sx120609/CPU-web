import taskpool from '@ohos.taskpool';
import { StorageDirectories, clearTemporaryFiles, storageUsageJson } from './StorageCleaner';

// 遍历沙箱目录可能涉及上千个文件，放到任务池里做，不占用界面线程。
// @Concurrent 函数只能使用参数和导入的符号，所以统计和删除的实现放在 StorageCleaner。

@Concurrent
function measureStorageTask(cacheDir: string, tempDirs: string[], dataDirs: string[]): string {
  const directories: StorageDirectories = { cacheDir: cacheDir, tempDirs: tempDirs, dataDirs: dataDirs };
  return storageUsageJson(directories);
}

@Concurrent
function clearTemporaryFilesTask(cacheDir: string, tempDirs: string[], dataDirs: string[]): void {
  const directories: StorageDirectories = { cacheDir: cacheDir, tempDirs: tempDirs, dataDirs: dataDirs };
  clearTemporaryFiles(directories);
}

export async function measureStorage(directories: StorageDirectories): Promise<string> {
  return await taskpool.execute(measureStorageTask, directories.cacheDir, directories.tempDirs, directories.dataDirs) as string;
}

export async function clearTemporaryStorage(directories: StorageDirectories): Promise<void> {
  await taskpool.execute(clearTemporaryFilesTask, directories.cacheDir, directories.tempDirs, directories.dataDirs);
}
