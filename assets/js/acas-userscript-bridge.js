const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const MESSAGE_TIMEOUT = isIOS ? 2000 : 500;

let userscriptPending = false;

window.addEventListener('message', (event) => {
    if (event.data?.type === 'ACAS_USERSCRIPT_PENDING' && event.data?.value === true) {
        userscriptPending = true;
        window.USERSCRIPT_PENDING = true;
    }
    if (event.data?.type === 'ACAS_USERSCRIPT_READY' && event.data?.value === true) {
        window.isUserscriptActive = true;
        userscriptPending = false;
    }
});

function messageUserscript(type, args = []) {
    return new Promise((resolve, reject) => {
        const messageId = getUniqueID();
        let timeoutId;

        const listener = (event) => {
            if(event.data.messageId === messageId && event.data.sender !== 'GUI') {
                clearTimeout(timeoutId);
                window.removeEventListener('message', listener);

                resolve(event.data.value);
            }
        };

        window.addEventListener('message', listener);

        timeoutId = setTimeout(() => {
            window.removeEventListener('message', listener);
            console.error(type, args);
            reject(new Error(`Response timed out after ${MESSAGE_TIMEOUT}ms`));
        }, MESSAGE_TIMEOUT);

        window.postMessage({
            sender: 'GUI',
            type,
            messageId,
            args
        }, '*');
    });
}

function createInstanceVar(key) {
    const iVarsMessageType = 'USERSCRIPT_instanceVars';

    return {
        set: (instanceId, newValue) => {
            return messageUserscript(iVarsMessageType, [instanceId, key, newValue]);
        },
        get: async (instanceId) => {
            return messageUserscript(iVarsMessageType, [instanceId, key]);
        }
    };
}

async function checkUserscriptActive() {
    try {
        const result = await messageUserscript('USERSCRIPT_checkActive', []);
        return result === true;
    } catch(e) {
        return false;
    }
}

// Do not continue if userscript has declared the object itself.
// This happens when unsafeWindow is supported by the manager.
// It allows for direct access which is faster.
if(typeof window?.USERSCRIPT !== 'object') {
    window.USERSCRIPT = {
        // ASYNC
        getValue: (key) => messageUserscript('USERSCRIPT_getValue', [key]),
        getInfo: () => messageUserscript('USERSCRIPT_getInfo'),
        listValues: () => messageUserscript('USERSCRIPT_listValues'),
        instanceVars: {
            playerColor: createInstanceVar('playerColor'),
            fen: createInstanceVar('fen')
        },
        // NON-ASYNC
        deleteValue: (key) => messageUserscript('USERSCRIPT_deleteValue', [key]),
        setValue: (key, value) => {
            window.postMessage({ 
                sender: 'GUI',
                type: 'USERSCRIPT_setValue',
                messageId: null,
                args: [key, value]
            }, '*');
        },
        checkActive: checkUserscriptActive
    };
}