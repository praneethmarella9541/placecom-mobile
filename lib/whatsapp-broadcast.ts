import type { WhatsAppTemplateMeta } from '../components/whatsapp/WhatsAppTemplatePanel';

export function applyTemplatePreview(
  template: Pick<WhatsAppTemplateMeta, 'name' | 'preview'>,
  variables: string[]
): string {
  const vars = variables.map((v) => v.trim());
  if (template.preview?.includes('{{')) {
    let out = template.preview;
    for (let i = 0; i < vars.length; i++) {
      out = out.split(`{{${i + 1}}}`).join(vars[i] || '…');
    }
    return out;
  }
  if (template.name === 'initial_conversation' && vars.length >= 2) {
    return `Hi ${vars[0] || '…'}, this is ${vars[1] || '…'} from PlaceCom`;
  }
  return template.preview ?? `[Template: ${template.name}]`;
}

export function templateVariableDisplayLabels(
  template: Pick<WhatsAppTemplateMeta, 'bodyParamCount' | 'preview' | 'name'>
): string[] {
  const count = template.bodyParamCount;
  if (count <= 0) return [];
  if (count === 1) return ['Value'];
  if (count === 2) return ['Recipient name', 'Your name'];
  return Array.from({ length: count }, (_, i) => `Field ${i + 1}`);
}

export type ColumnMapping = number | null;

export function autoMapColumns(headers: string[], varLabels: string[]): ColumnMapping[] {
  return varLabels.map((label) => {
    const lbl = label.toLowerCase();
    const match = headers.findIndex((h) => {
      const hk = h.toLowerCase();
      if (lbl.includes('recipient') || lbl.includes('name')) {
        return /^(name|full.?name|recipient|contact|first.?name)$/.test(hk);
      }
      if (lbl.includes('your name') || lbl.includes('sender')) {
        return /^(sender|your.?name|from|agent|staff|employee)$/.test(hk);
      }
      return hk === lbl || hk.replace(/\s/g, '_') === lbl.replace(/\s/g, '_');
    });
    return match >= 0 ? match : null;
  });
}
