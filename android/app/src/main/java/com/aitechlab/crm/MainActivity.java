package com.aitechlab.crm;

import android.os.Bundle;
import android.content.Intent;
import android.content.pm.PackageManager;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(KioskPlugin.class);
    }
}

@CapacitorPlugin(name = "KioskPlugin")
class KioskPlugin extends Plugin {
    @PluginMethod
    public void enterKioskMode(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startLockTask();
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void exitKioskMode(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().stopLockTask();
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String packageName = call.getString("package");
        if (packageName == null) {
            call.reject("Package name is required");
            return;
        }
        PackageManager pm = getContext().getPackageManager();
        Intent intent = pm.getLaunchIntentForPackage(packageName);
        if (intent != null) {
            getContext().startActivity(intent);
            call.resolve();
        } else {
            call.reject("App not found: " + packageName);
        }
    }
}
