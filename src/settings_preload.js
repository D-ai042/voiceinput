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
     * @param {object} settings - 包含所有模块的配置项
     */
    saveSettings: (settings) => {
        return ipcRenderer.invoke('save-settings', settings);
    }
});
