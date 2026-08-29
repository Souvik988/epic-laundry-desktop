export {}

declare global {
  interface Window {
    epic?: {
      backup: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
      restore: () => Promise<{ ok: boolean; canceled?: boolean; restored?: string }>
      encryptedBackup: (passphrase: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
      encryptedRestore: (passphrase: string) => Promise<{ ok: boolean; canceled?: boolean; restored?: string }>
      printHtml: (html: string) => Promise<{ ok: boolean; canceled?: boolean }>
      saveFile: (opts: { content: string; suggestedName?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
      openBackupsFolder: () => Promise<string | undefined>
      backupLocation: () => Promise<{ configured: boolean; path: string }>
      backupStatus: () => Promise<{ configured: boolean; path: string; healthy: boolean; writable: boolean; stale: boolean; ageHours: number | null; reason: string; encrypted: boolean; latest: string | null; rehearsal?: { ok: boolean; verifiedAt: string; snapshot: string; encrypted: boolean; rows: number; financialEntries: number; financialDocuments: number; customerLedgerEntries: number; cashShiftCloses: number; freshDatabase?: { ok: boolean; isolatedDatabase: boolean; digest: string; counts: Record<string, number> } } | null }>
      verifyLatestBackup: () => Promise<{ ok: boolean; verifiedAt: string; snapshot: string; encrypted: boolean; rows: number; financialEntries: number; financialDocuments: number; customerLedgerEntries: number; cashShiftCloses: number }>
      chooseBackupLocation: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>
      workspaceStatus: () => Promise<{ mode: 'production' | 'demo' }>
      selectWorkspace: (mode: 'production' | 'demo') => Promise<{ mode: 'production' | 'demo'; changed: boolean }>
      resetDemoWorkspace: () => Promise<{ ok: boolean }>
    }
  }
}
