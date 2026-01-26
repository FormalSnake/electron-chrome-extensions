import { ipcRenderer } from 'electron'

const formatIpcName = (name: string) => `crx-${name}`

const listenerMap = new Map<string, number>()

export const addExtensionListener = (extensionId: string, name: string, callback: Function) => {
  const ipcName = formatIpcName(name)
  const listenerCount = listenerMap.get(name) || 0

  console.log('[event.ts] addExtensionListener called', { extensionId, name, ipcName, listenerCount, processType: process.type })

  if (listenerCount === 0) {
    // TODO: should these IPCs be batched in a microtask?
    console.log('[event.ts] Sending crx-add-listener IPC', { extensionId, name })
    ipcRenderer.send('crx-add-listener', extensionId, name)
  }

  listenerMap.set(name, listenerCount + 1)

  console.log('[event.ts] Adding ipcRenderer listener for', ipcName)
  ipcRenderer.addListener(ipcName, function (event, ...args) {
    console.log('[event.ts] IPC received on channel', ipcName, 'args:', args)
    if (process.env.NODE_ENV === 'development') {
      console.log(name, '(result)', ...args)
    }
    callback(...args)
  })
  console.log('[event.ts] Listener added for', ipcName, 'total listeners:', listenerMap.get(name))
}

export const removeExtensionListener = (extensionId: string, name: string, callback: any) => {
  if (listenerMap.has(name)) {
    const listenerCount = listenerMap.get(name) || 0

    if (listenerCount <= 1) {
      listenerMap.delete(name)

      ipcRenderer.send('crx-remove-listener', extensionId, name)
    } else {
      listenerMap.set(name, listenerCount - 1)
    }
  }

  ipcRenderer.removeListener(formatIpcName(name), callback)
}
