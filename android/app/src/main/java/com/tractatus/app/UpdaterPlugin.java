package com.tractatus.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Native support for self-updating the sideloaded APK from GitHub releases.
 * Adapted for Tractatus (Kono-o/tractatus).
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("Missing 'path' (relative to app cache dir)");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                        openUnknownSourcesSettings();
                        call.reject("permission_required");
                        return;
                    }
                }

                File apkFile = resolveCacheFile(path);
                if (!apkFile.exists() || !apkFile.isFile()) {
                    call.reject("APK file not found at " + path);
                    return;
                }

                String authority = getContext().getPackageName() + ".fileprovider";
                Uri apkUri = FileProvider.getUriForFile(getContext(), authority, apkFile);

                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "Unknown error launching installer");
            }
        });
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        openUnknownSourcesSettings();
        call.resolve();
    }

    @PluginMethod
    public void canInstallFromUnknownSources(PluginCall call) {
        boolean canInstall = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            canInstall = getContext().getPackageManager().canRequestPackageInstalls();
        }
        JSObject ret = new JSObject();
        ret.put("canInstall", canInstall);
        call.resolve(ret);
    }

    private void openUnknownSourcesSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    private File resolveCacheFile(String relativePath) {
        File cacheDir = getContext().getCacheDir();
        return new File(cacheDir, relativePath);
    }
}
