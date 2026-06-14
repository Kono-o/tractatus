package com.tractatus.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.ComponentName;
import android.content.pm.PackageManager;

@CapacitorPlugin(name = "IconSwitcher")
public class IconSwitcherPlugin extends Plugin {

    private static final String MAIN_ALIAS = "com.tractatus.app.MainActivity";
    private static final String DARK_ALIAS = "com.tractatus.app.MainActivityDark";

    @PluginMethod
    public void setIcon(PluginCall call) {
        String icon = call.getString("icon", "light");

        PackageManager pm = getContext().getPackageManager();
        ComponentName main = new ComponentName(getContext(), MAIN_ALIAS);
        ComponentName dark = new ComponentName(getContext(), DARK_ALIAS);

        if ("dark".equals(icon)) {
            pm.setComponentEnabledSetting(main,
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(dark,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP);
        } else {
            pm.setComponentEnabledSetting(dark,
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(main,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP);
        }

        call.resolve();
    }
}
