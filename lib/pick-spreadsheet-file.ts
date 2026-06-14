import { Alert, InteractionManager } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { DocumentPickerAsset } from 'expo-document-picker';

const SPREADSHEET_EXTENSIONS = ['.csv', '.xls', '.xlsx'] as const;

const SPREADSHEET_MIMES = new Set([
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export function isSpreadsheetFile(name: string, mimeType?: string | null): boolean {
  const lowerName = name.trim().toLowerCase();
  if (SPREADSHEET_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return true;
  const mime = (mimeType ?? '').trim().toLowerCase();
  return SPREADSHEET_MIMES.has(mime);
}

let pickerBusy = false;

/** Local file picker for CSV/Excel — avoids Android routing to Drive when MIME filters are set. */
export async function pickSpreadsheetFile(): Promise<DocumentPickerAsset | null> {
  if (pickerBusy) return null;
  pickerBusy = true;

  try {
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => resolve());
    });

    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled || !result.assets[0]) return null;

    const asset = result.assets[0];
    const name = asset.name?.trim() || 'file';
    if (!isSpreadsheetFile(name, asset.mimeType)) {
      Alert.alert(
        'Unsupported file',
        'Please choose a CSV or Excel file (.csv, .xls, .xlsx).'
      );
      return null;
    }

    return asset;
  } catch (e: unknown) {
    Alert.alert(
      'Could not open file picker',
      e instanceof Error ? e.message : 'Try again or pick a file stored on this device.'
    );
    return null;
  } finally {
    pickerBusy = false;
  }
}
