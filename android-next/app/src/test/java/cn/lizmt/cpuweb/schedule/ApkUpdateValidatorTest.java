package cn.lizmt.cpuweb.schedule;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Arrays;
import java.util.Collections;

public class ApkUpdateValidatorTest {
    @Test
    public void acceptsHigherVersionWithMatchingIdentity() throws Exception {
        ApkUpdateValidator.requireCompatible(
                "cn.lizmt.cpuweb",
                34,
                Collections.singletonList("release-cert"),
                "cn.lizmt.cpuweb",
                35,
                Collections.singletonList("release-cert")
        );
    }

    @Test
    public void rejectsWrongPackage() {
        assertRejected(
                "更新包身份不匹配，已停止安装",
                "cn.lizmt.cpuweb.schedule",
                35,
                Collections.singletonList("release-cert")
        );
    }

    @Test
    public void rejectsNonUpgradeVersion() {
        assertRejected(
                "下载的不是更高版本，已停止安装",
                "cn.lizmt.cpuweb",
                34,
                Collections.singletonList("release-cert")
        );
    }

    @Test
    public void rejectsDifferentSigner() {
        assertRejected(
                "更新包签名不匹配，已停止安装",
                "cn.lizmt.cpuweb",
                35,
                Collections.singletonList("other-cert")
        );
    }

    @Test
    public void recognizesApkZipHeader() throws Exception {
        File file = File.createTempFile("cpu-web-update", ".apk");
        try {
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(new byte[]{0x50, 0x4b, 0x03, 0x04, 0x01});
            }
            assertTrue(ApkUpdateValidator.hasZipHeader(file));
        } finally {
            file.delete();
        }
    }

    private void assertRejected(
            String message,
            String updatePackage,
            long updateVersion,
            java.util.List<String> updateSigners
    ) {
        try {
            ApkUpdateValidator.requireCompatible(
                    "cn.lizmt.cpuweb",
                    34,
                    Arrays.asList("release-cert"),
                    updatePackage,
                    updateVersion,
                    updateSigners
            );
            fail("Expected validation failure");
        } catch (ApkUpdateValidator.ValidationException error) {
            assertEquals(message, error.getMessage());
        }
    }
}
