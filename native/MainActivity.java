package it.collezione.euro;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
