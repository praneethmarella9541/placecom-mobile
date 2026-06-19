import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  ScrollView,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type WhatsAppTemplateMeta = {
  name: string;
  languageCode?: string;
  bodyParamCount: number;
  label: string;
  preview?: string;
};

function applyPreview(tpl: WhatsAppTemplateMeta, variables: string[]): string {
  const vars = variables.map((v) => v.trim());
  if (tpl.preview?.includes('{{')) {
    let out = tpl.preview;
    for (let i = 0; i < vars.length; i++) {
      out = out.split(`{{${i + 1}}}`).join(vars[i] || '…');
    }
    return out;
  }
  if (tpl.name === 'initial_conversation' && vars.length >= 2) {
    return `Hi ${vars[0] || '…'}, this is ${vars[1] || '…'} from PlaceCom`;
  }
  return tpl.preview ?? `[Template: ${tpl.name}]`;
}

function getVarLabels(tpl: WhatsAppTemplateMeta | undefined): string[] {
  const count = tpl?.bodyParamCount ?? 2;
  if (count === 0) return [];
  if (count === 1) return ['Value'];
  if (count === 2) return ['Recipient name', 'Your name'];
  return Array.from({ length: count }, (_, i) => `Field ${i + 1}`);
}

type Props = {
  needsTemplate: boolean;
  templates: WhatsAppTemplateMeta[];
  selectedTemplateName: string;
  onTemplateChange: (name: string) => void;
  templateVariables: string[];
  onTemplateVariablesChange: (vars: string[]) => void;
  forceTemplate: boolean;
  onForceTemplateChange: (v: boolean) => void;
};

export function WhatsAppTemplatePanel({
  needsTemplate,
  templates,
  selectedTemplateName,
  onTemplateChange,
  templateVariables,
  onTemplateVariablesChange,
  forceTemplate,
  onForceTemplateChange,
}: Props) {
  const [open, setOpen] = useState(needsTemplate);

  useEffect(() => {
    if (needsTemplate) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setOpen(true);
    }
  }, [needsTemplate]);

  function toggle() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  }

  const selectedTemplate =
    templates.find((t) => t.name === selectedTemplateName) ?? templates[0];

  const varLabels = getVarLabels(selectedTemplate);
  const filledCount = varLabels.filter((_, i) => (templateVariables[i] ?? '').trim()).length;
  const allFilled = filledCount >= varLabels.length;

  const previewText =
    selectedTemplate && templateVariables.some((v) => v.trim())
      ? applyPreview(selectedTemplate, templateVariables)
      : selectedTemplate?.preview?.replace(/\{\{\d+\}\}/g, '…') ?? '…';

  const summaryLabel = selectedTemplate?.label ?? selectedTemplate?.name ?? 'Template';

  return (
    <View style={[styles.card, needsTemplate ? styles.cardRequired : styles.cardOptional]}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <TouchableOpacity style={styles.header} onPress={toggle} activeOpacity={0.75}>
        <View style={[styles.iconBox, needsTemplate ? styles.iconBoxRequired : styles.iconBoxOptional]}>
          <Text style={[styles.iconText, !needsTemplate && styles.iconTextOptional]}>
            {needsTemplate ? '!' : 'T'}
          </Text>
        </View>

        <View style={styles.headerMeta}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {needsTemplate ? 'Approved template required' : 'Template options'}
            </Text>
            {needsTemplate ? (
              <View style={styles.badgeRequired}>
                <Text style={styles.badgeRequiredText}>SESSION CLOSED</Text>
              </View>
            ) : forceTemplate ? (
              <View style={styles.badgeForce}>
                <Text style={styles.badgeForceText}>FORCE TEMPLATE</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.headerSub} numberOfLines={1}>
            {open
              ? needsTemplate
                ? 'Fill variables — recipient must reply to open free chat'
                : 'Optional template for outside the 24 h window'
              : `${summaryLabel}${needsTemplate && !allFilled ? ` · ${filledCount}/${varLabels.length} fields` : ''}`}
          </Text>
        </View>

        <Ionicons
          name={open ? 'chevron-down' : 'chevron-back'}
          size={16}
          color={Colors.textMuted}
        />
      </TouchableOpacity>

      {/* ── Expanded body ───────────────────────────────────────────────── */}
      {open ? (
        <ScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Template picker (only when there are multiple templates) */}
          {templates.length > 1 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>TEMPLATE</Text>
              <View style={styles.pickerList}>
                {templates.map((t) => {
                  const active = t.name === selectedTemplateName;
                  return (
                    <TouchableOpacity
                      key={t.name}
                      style={[styles.pickerRow, active && styles.pickerRowActive]}
                      onPress={() => onTemplateChange(t.name)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.pickerRowText, active && styles.pickerRowTextActive]}>
                        {t.label}
                      </Text>
                      {active ? <Ionicons name="checkmark" size={14} color="#075E54" /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : selectedTemplate ? (
            <Text style={styles.singleLabel}>{selectedTemplate.label}</Text>
          ) : null}

          {/* Preview */}
          <View style={styles.previewBox}>
            <Text style={styles.sectionLabel}>PREVIEW</Text>
            <View style={styles.previewBubbleRow}>
              <View style={styles.previewBubble}>
                <Text style={styles.previewBubbleText}>{previewText}</Text>
              </View>
            </View>
          </View>

          {/* Variable inputs */}
          {varLabels.length > 0 ? (
            <View style={styles.varsContainer}>
              {varLabels.map((label, i) => {
                const value = templateVariables[i] ?? '';
                const filled = Boolean(value.trim());
                return (
                  <View key={`${selectedTemplateName ?? 'tpl'}-var-${i}`} style={styles.varField}>
                    <View style={styles.varLabelRow}>
                      <View style={[styles.varDot, filled && styles.varDotFilled]}>
                        {filled ? (
                          <Ionicons name="checkmark" size={9} color="#fff" />
                        ) : (
                          <Text style={styles.varDotNum}>{i + 1}</Text>
                        )}
                      </View>
                      <Text style={styles.varLabel}>{label}</Text>
                    </View>
                    <TextInput
                      style={styles.varInput}
                      value={value}
                      onChangeText={(v) => {
                        const next = [...templateVariables];
                        next[i] = v;
                        onTemplateVariablesChange(next);
                      }}
                      placeholder={`Enter ${label.toLowerCase()}`}
                      placeholderTextColor={Colors.textMuted}
                    />
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Force-template toggle */}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel} numberOfLines={2}>
              {needsTemplate
                ? 'Always use template (even after they reply)'
                : 'Send as template instead of free text'}
            </Text>
            <Switch
              value={forceTemplate}
              onValueChange={onForceTemplateChange}
              trackColor={{ true: '#075E54', false: Colors.border }}
              thumbColor={Colors.surface}
              style={styles.toggle}
            />
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const GREEN = '#075E54';
const GREEN_LIGHT = '#e7f8ef';
const GREEN_BUBBLE = '#DCF8C6';

const styles = StyleSheet.create({
  // ── Card shell ─────────────────────────────────────────────────────────
  card: {
    marginHorizontal: 6,
    marginBottom: 6,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardRequired: {
    borderColor: '#c8e6d4',
    backgroundColor: '#f4fbf7',
    // Subtle elevation
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  cardOptional: {
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },

  // ── Header row ─────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconBoxRequired: {
    backgroundColor: GREEN,
    shadowColor: GREEN,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  iconBoxOptional: {
    backgroundColor: GREEN_LIGHT,
  },
  iconText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  iconTextOptional: {
    color: GREEN,
  },
  headerMeta: { flex: 1, minWidth: 0 },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    flexShrink: 1,
  },
  headerSub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },

  // ── Status badges ──────────────────────────────────────────────────────
  badgeRequired: {
    backgroundColor: '#dcf8e8',
    borderRadius: 100,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeRequiredText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: GREEN,
  },
  badgeForce: {
    backgroundColor: GREEN_LIGHT,
    borderRadius: 100,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeForceText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: GREEN,
  },

  // ── Expanded body ──────────────────────────────────────────────────────
  bodyScroll: {
    maxHeight: 280,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  body: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  section: { gap: 6 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  singleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },

  // ── Template picker ────────────────────────────────────────────────────
  pickerList: { gap: 4 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  pickerRowActive: {
    borderColor: '#c8e6d4',
    backgroundColor: GREEN_LIGHT,
  },
  pickerRowText: { fontSize: 13, color: Colors.textMuted },
  pickerRowTextActive: { color: GREEN, fontWeight: '600' },

  // ── Preview bubble ─────────────────────────────────────────────────────
  previewBox: { gap: 6 },
  previewBubbleRow: {
    alignItems: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d9f0e3',
    backgroundColor: 'rgba(255,255,255,0.8)',
    padding: 10,
  },
  previewBubble: {
    maxWidth: '92%',
    backgroundColor: GREEN_BUBBLE,
    borderRadius: 12,
    borderBottomRightRadius: 3,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  previewBubbleText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#111b21',
  },

  // ── Variable inputs ────────────────────────────────────────────────────
  varsContainer: { gap: 10 },
  varField: { gap: 5 },
  varLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  varDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  varDotFilled: { backgroundColor: GREEN },
  varDotNum: { fontSize: 9, fontWeight: '700', color: Colors.textMuted },
  varLabel: { fontSize: 11, fontWeight: '600', color: Colors.textMuted },
  varInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },

  // ── Force-template toggle ──────────────────────────────────────────────
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
  },
  toggleLabel: {
    flex: 1,
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  toggle: { flexShrink: 0 },
});
