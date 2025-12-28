let started = false;
let userscriptReadyViaMessage = false;
let userscriptPendingViaMessage = false;
let MainCommLink = null;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

console.log('[ACAS GUI] Initial state - USERSCRIPT:', typeof window.USERSCRIPT, 'isUserscriptActive:', window.isUserscriptActive, 'USERSCRIPT_PENDING:', window.USERSCRIPT_PENDING);

function initCommLink() {
    if (MainCommLink) return;
    if (typeof USERSCRIPT !== 'object') return;
    
    MainCommLink = new CommLinkHandler('mum', {
        'singlePacketResponseWaitTime': 1500,
        'maxSendAttempts': 3,
        'statusCheckInterval': 1,
        'silentMode': true,
        'functions': {
            'getValue': USERSCRIPT.getValue,
            'setValue': USERSCRIPT.setValue,
            'deleteValue': USERSCRIPT.deleteValue,
            'listValues': USERSCRIPT.listValues,
        }
    });

    MainCommLink.registerListener('mum', packet => {
        try {
            switch(packet.command) {
                case 'ping':
                    return `pong (took ${Date.now() - packet.date}ms)`;
                case 'createInstance':
                    const data = packet.data;

                    createInstance(data.domain, data.instanceID, data.chessVariant);
        
                    return true;
            }
        } catch(e) {
            console.error(e);
            return null;
        }
    });
    
    log.info('CommLink initialized and listening for instance calls...');
}

window.addEventListener('message', (event) => {
    if (event.data?.type === 'ACAS_USERSCRIPT_PENDING' && event.data?.value === true) {
        console.log('[ACAS GUI] Received ACAS_USERSCRIPT_PENDING message');
        userscriptPendingViaMessage = true;
        window.USERSCRIPT_PENDING = true;
    }
    if (event.data?.type === 'ACAS_USERSCRIPT_READY' && event.data?.value === true) {
        console.log('[ACAS GUI] Received ACAS_USERSCRIPT_READY message');
        userscriptReadyViaMessage = true;
        userscriptPendingViaMessage = false;
        window.isUserscriptActive = true;
        initCommLink();
        attemptStarting();
    }
});

async function waitForUserscript(maxWaitMs = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
        if (window.isUserscriptActive === true || 
            (typeof window.USERSCRIPT === 'object' && window.USERSCRIPT !== null)) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

async function attemptStarting() {
    if(started)
        return;

    console.log('[ACAS GUI] attemptStarting called');
    console.log('[ACAS GUI] State - USERSCRIPT:', typeof window.USERSCRIPT, 'isUserscriptActive:', window.isUserscriptActive, 'USERSCRIPT_PENDING:', window.USERSCRIPT_PENDING);

    const isPending = window.USERSCRIPT_PENDING || userscriptPendingViaMessage || 
                      window.isUserscriptActive === 'pending';
    
    if (isPending && !window.isUserscriptActive) {
        console.log('[ACAS GUI] Userscript pending, waiting for full initialization...');
        await waitForUserscript(5000);
    }

    // On iOS, wait a bit longer for userscript to initialize
    if(isIOS && !window.isUserscriptActive && !userscriptReadyViaMessage) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const isUserscriptActive = window.isUserscriptActive === true || userscriptReadyViaMessage;
    let isTosAccepted = false;
    
    console.log('[ACAS GUI] Final check - isUserscriptActive:', isUserscriptActive, 'window.isUserscriptActive:', window.isUserscriptActive, 'userscriptReadyViaMessage:', userscriptReadyViaMessage);
    
    if(isUserscriptActive) {
        try {
            isTosAccepted = await USERSCRIPT.getValue('isTosAccepted');
        } catch(e) {
            console.warn('Failed to get isTosAccepted, retrying...', e);
            // Retry once on iOS
            if(isIOS) {
                await new Promise(resolve => setTimeout(resolve, 300));
                try {
                    isTosAccepted = await USERSCRIPT.getValue('isTosAccepted');
                } catch(e2) {
                    console.error('Failed to get isTosAccepted after retry', e2);
                }
            }
        }
    }

    if(isUserscriptActive) {
        started = true;

        displayNoUserscriptNotification(true);
        initCommLink();
    }
        
    if(!isUserscriptActive) {
        displayNoUserscriptNotification();

    } else if(!isTosAccepted) {
        displayNoUserscriptNotification(true); // failsafe
        started = true; // failsafe

        displayTOS();

    } else {
        displayNoUserscriptNotification(true); // failsafe
        started = true; // failsafe

        initializeDatabase();
        initGUI();

        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);
        const highlight = urlParams.get('hl');
        const settingToHighlight = urlParams.get('shl');

        if(highlight) {
            switch(highlight) {
                case 'controlPanel':
                    highlightSetting(document.querySelector('#settings-control-panel'), 
                        removeParamFromUrl('hl'));
                    break;
                case 'supportedSites':
                    highlightSetting(document.querySelector('#see-supported-sites-btn'), 
                        removeParamFromUrl('hl'));
                    break;
            }
            
        } else if(settingToHighlight) {
            const foundSettingElem = [...document.querySelectorAll('input[data-key]')]
                .find(elem => elem.dataset.key === settingToHighlight);

            const settingContainer = foundSettingElem?.closest('.custom-input');

            if(foundSettingElem && settingContainer) {
                highlightSetting(settingContainer, () => removeParamFromUrl('shl'));
            }
        }

        log.info('Userscript ready! Listening to instance calls...');

        const autoMoveCheckbox = document.querySelector('input[data-key="autoMove"]');
        const hiddenSettingPanel = document.querySelector('#hidden-setting-panel');

        if(urlParams.get('hidden') === 'true')
            hiddenSettingPanel.classList.remove('hidden');

        else if(autoMoveCheckbox?.checked)
            autoMoveCheckbox.click();

        initCommLink();
    }

    async function initDbValue(name, value) {
        const dbValue = await USERSCRIPT.getValue(name);

        if(dbValue == undefined) {
            USERSCRIPT.setValue(name, value);
        }

        return true;
    }

    async function initializeDatabase() {
        const gmConfigKey = GLOBAL_VARIABLES.gmConfigKey;
        const tempValueIndicator = GLOBAL_VARIABLES.tempValueIndicator;

        // add AcasConfig value if it doesn't exist already
        await initDbValue(gmConfigKey, { 'global': {} });

        const gmStorageKeys = await USERSCRIPT.listValues();
        const tempValueKeys = gmStorageKeys.filter(key => key.includes(tempValueIndicator));
        const config = await USERSCRIPT.getValue(gmConfigKey);
        
        const configInstances = config?.instance;
        
        // removes instance config values from instance IDs that aren't active anymore
        if(configInstances) {
            const configInstanceKeys = Object.keys(configInstances);

            configInstanceKeys.forEach(instanceIdKey => {
                const isConfigInstanceRelevant = tempValueKeys.find(key => key.includes(instanceIdKey))
                    ? true : false;

                if(!isConfigInstanceRelevant) {
                    delete config.instance[instanceIdKey];

                    USERSCRIPT.setValue(gmConfigKey, config);
                }
            });
        }
        
        const expiredKeys = await Promise.all(
            tempValueKeys.map(async key => {
                const configValue = await USERSCRIPT.getValue(key);
                const isExpired = Date.now() - configValue.date > 6e4 * 60;
                return isExpired ? key : null;
            })
        );
        
        // removes temp values with no usage for over 60 minutes
        expiredKeys
            .filter(key => key !== null)
            .forEach(key => USERSCRIPT.deleteValue(key));
    }
}

(async () => {
    ensureSabParam();
    await attemptStarting();

    const userscriptSearchInterval = setIntervalAsync(async () => {
        if(!started)
            await attemptStarting();
        else
            userscriptSearchInterval.stop();
    }, 1);
})();