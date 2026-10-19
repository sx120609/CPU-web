package cn.lizmt.cpuweb.schedule;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class ApkUpdateValidator {
    private static final long MIN_APK_BYTES = 64 * 1024;

    private ApkUpdateValidator() {
    }

    static void validate(Context context, File apkFile) throws ValidationException {
        if (apkFile == null || !apkFile.isFile() || apkFile.length() < MIN_APK_BYTES || !hasZipHeader(apkFile)) {
            throw new ValidationException("下载的更新包不完整，请重新下载");
        }

        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
        PackageInfo installed;
        try {
            installed = manager.getPackageInfo(context.getPackageName(), flags);
        } catch (PackageManager.NameNotFoundException error) {
            throw new ValidationException("无法确认当前版本，请重新打开应用后再试", error);
        }

        PackageInfo update = manager.getPackageArchiveInfo(apkFile.getAbsolutePath(), flags);
        if (update == null) {
            throw new ValidationException("下载的文件不是有效安装包，请重新下载");
        }

        requireCompatible(
                context.getPackageName(),
                versionCode(installed),
                signerDigests(installed),
                update.packageName,
                versionCode(update),
                signerDigests(update)
        );
    }

    static void requireCompatible(
            String expectedPackage,
            long installedVersion,
            List<String> installedSigners,
            String updatePackage,
            long updateVersion,
            List<String> updateSigners
    ) throws ValidationException {
        if (!expectedPackage.equals(updatePackage)) {
            throw new ValidationException("更新包身份不匹配，已停止安装");
        }
        if (updateVersion <= installedVersion) {
            throw new ValidationException("下载的不是更高版本，已停止安装");
        }
        if (installedSigners.isEmpty() || !installedSigners.equals(updateSigners)) {
            throw new ValidationException("更新包签名不匹配，已停止安装");
        }
    }

    static boolean hasZipHeader(File file) {
        try (FileInputStream input = new FileInputStream(file)) {
            return input.read() == 0x50
                    && input.read() == 0x4b
                    && input.read() == 0x03
                    && input.read() == 0x04;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
    }

    private static List<String> signerDigests(PackageInfo info) throws ValidationException {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (info.signingInfo == null) return Collections.emptyList();
            signatures = info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length == 0) return Collections.emptyList();

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            ArrayList<String> values = new ArrayList<>();
            for (Signature signature : signatures) {
                byte[] hash = digest.digest(signature.toByteArray());
                StringBuilder value = new StringBuilder(hash.length * 2);
                for (byte item : hash) value.append(String.format("%02x", item & 0xff));
                values.add(value.toString());
            }
            Collections.sort(values);
            return values;
        } catch (Exception error) {
            throw new ValidationException("更新包签名校验失败，已停止安装", error);
        }
    }

    static final class ValidationException extends Exception {
        ValidationException(String message) {
            super(message);
        }

        ValidationException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
