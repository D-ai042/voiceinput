const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
    /**
     * 加载当前设置
     */
    loadSettings: () => {
        return ipcRenderer.invoke('load-settings');
    },

    /**
     * 保存设置
     * @param {object} settings - { PROVIDER, BAIDU_APP_ID, BAIDU_API_KEY, BAIDU_SECRET_KEY }
     */
    saveSettings: (settings) => {
        return ipcRenderer.invoke('save-settings', settings);
    }
});
