export {}

declare global {
  interface Window {
    epic?: {
      backup: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
      restore: () => Promise<{ ok: boolean; canceled?: boolean; restored?: string }>
      printHtml: (html: string) => Promise<{ ok: boolean; canceled?: boolean }>
      openBackupsFolder: () => Promise<string | undefined>
    }
  }
}
