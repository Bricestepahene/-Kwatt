/**
 * « Exporter mes données » (écran 13) : le JSON de GET /v1/me/export, en fichier.
 * Téléphone : fichier dans le cache, puis feuille de partage du système (expo-sharing).
 * Web : téléchargement direct.
 */
import type { ExportResponse } from '@kwatt/protocol';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { accountsApi } from './api';

export function exportFileName(data: Pick<ExportResponse, 'exportedAt'>): string {
  return `kwatt-export-${data.exportedAt.slice(0, 10)}.json`;
}

/** Récupère l'export et le propose au joueur. `dialogTitle` : titre de la feuille de partage (Android). */
export async function exportMyData(dialogTitle: string): Promise<'shared' | 'downloaded'> {
  const data = await accountsApi.exportData();
  const name = exportFileName(data);
  const json = JSON.stringify(data, null, 2);

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  }

  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(json);
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle });
  return 'shared';
}
