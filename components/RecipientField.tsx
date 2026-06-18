import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type TextInput as RNTextInput,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gmail, avatarColorForName } from '../constants/gmailTheme';
import {
  isCompleteEmailAddress,
  parseRecipientValue,
  serializeRecipientValue,
  type RecipientChipData,
} from '../lib/email-recipients';
import { extractEmailAddress } from '../lib/recipient-utils';

export type RecipientSuggestion = {
  email: string;
  displayName?: string;
};

export type RecipientFieldHandle = {
  applySuggestion: (s: RecipientSuggestion) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: React.RefObject<RNTextInput | null>;
  onDraftChange?: (draft: string) => void;
  onFocus?: () => void;
  style?: StyleProp<ViewStyle>;
};

function chipLabel(chip: RecipientChipData): string {
  return chip.displayName?.trim() || chip.email;
}

/** Web `RecipientField` — chips + draft; suggestions rendered by parent at full width. */
export const RecipientField = forwardRef<RecipientFieldHandle, Props>(function RecipientField(
  {
    value,
    onChange,
    placeholder,
    inputRef: externalInputRef,
    onDraftChange,
    onFocus,
    style,
  },
  ref
) {
  const internalInputRef = useRef<RNTextInput>(null);
  const inputRef = externalInputRef ?? internalInputRef;
  const [chips, setChips] = useState<RecipientChipData[]>([]);
  const [draft, setDraft] = useState('');
  const lastEmittedRef = useRef('');

  const emit = useCallback(
    (nextChips: RecipientChipData[], nextDraft: string) => {
      const s = serializeRecipientValue(nextChips, nextDraft);
      lastEmittedRef.current = s;
      onChange(s);
      onDraftChange?.(nextDraft);
    },
    [onChange, onDraftChange]
  );

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const p = parseRecipientValue(value);
    setChips(p.chips);
    setDraft(p.draft);
    onDraftChange?.(p.draft);
  }, [value, onDraftChange]);

  const addChip = useCallback(
    (chip: RecipientChipData) => {
      const email = chip.email.trim().toLowerCase();
      if (!email) return;
      if (chips.some((c) => c.email === email)) {
        setDraft('');
        emit(chips, '');
        return;
      }
      const next = [...chips, { ...chip, email }];
      setChips(next);
      setDraft('');
      emit(next, '');
    },
    [chips, emit]
  );

  useImperativeHandle(
    ref,
    () => ({
      applySuggestion(s: RecipientSuggestion) {
        addChip({
          email: s.email.trim().toLowerCase(),
          displayName: s.displayName?.trim() || undefined,
        });
      },
      focus() {
        inputRef.current?.focus();
      },
    }),
    [addChip, inputRef]
  );

  const removeChip = useCallback(
    (index: number) => {
      const next = chips.filter((_, j) => j !== index);
      setChips(next);
      emit(next, draft);
    },
    [chips, draft, emit]
  );

  const handleDraftChange = useCallback(
    (raw: string) => {
      if (raw.includes(',')) {
        const segments = raw.split(',');
        const completed = segments.slice(0, -1);
        const remainder = segments[segments.length - 1] ?? '';
        const nextChips = [...chips];
        for (const seg of completed) {
          const t = seg.trim();
          if (!t) continue;
          if (isCompleteEmailAddress(t)) {
            const email = extractEmailAddress(t).trim().toLowerCase();
            if (!nextChips.some((c) => c.email === email)) {
              nextChips.push({ email });
            }
          }
        }
        setChips(nextChips);
        setDraft(remainder);
        emit(nextChips, remainder);
        return;
      }
      setDraft(raw);
      emit(chips, raw);
    },
    [chips, emit]
  );

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.inputWrap}>
        {chips.map((chip, i) => (
          <View key={`${chip.email}-${i}`} style={styles.chip}>
            <View
              style={[
                styles.chipAvatar,
                { backgroundColor: avatarColorForName(chipLabel(chip)) },
              ]}
            >
              <Text style={styles.chipAvatarText}>
                {chipLabel(chip).charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.chipText} numberOfLines={1}>
              {chipLabel(chip)}
            </Text>
            <TouchableOpacity
              onPress={() => removeChip(i)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityLabel={`Remove ${chip.email}`}
            >
              <Text style={styles.chipRemove}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={draft}
          onChangeText={handleDraftChange}
          onFocus={onFocus}
          placeholder={chips.length === 0 ? placeholder : ''}
          placeholderTextColor={Gmail.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { width: '100%', minWidth: 0 },
  inputWrap: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    maxWidth: '92%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Gmail.border,
    backgroundColor: Gmail.bgMuted,
    paddingLeft: 4,
    paddingRight: 6,
    paddingVertical: 3,
  },
  chipAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAvatarText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  chipText: { fontSize: 13, fontWeight: '500', color: Gmail.text, flexShrink: 1 },
  chipRemove: { fontSize: 18, lineHeight: 20, color: Gmail.textMuted, paddingHorizontal: 2 },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 96,
    minWidth: 96,
    fontSize: 15,
    color: Gmail.text,
    padding: 0,
  },
});
