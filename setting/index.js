import { normalizeGetReadySeconds } from '../shared/timed-settings.js';
import { normalizeExerciseImages } from '../shared/exercise-images.js';
import { normalizeAutoPrepare } from '../shared/auto-prepare.js';
import { normalizeWorkoutDisplaySettings } from '../shared/workout-display-settings.js';
import { WORKOUT_DIAGNOSTICS_KEY, WORKOUT_DIAGNOSTICS_ENABLED_KEY, WORKOUT_DIAGNOSTICS_EMPTY, formatWorkoutDiagnostics, normalizeWorkoutDiagnosticsEnabled } from '../shared/workout-diagnostics.js';

function isDemoApiKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return !key || key === 'demo' || key === 'dummy';
}

function normalizeScreenOnDuration(value) {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch (e) {
      // Plain Select values are not JSON.
    }
  }
  if (typeof candidate === 'object' && candidate !== null) {
    candidate = candidate.value;
  }
  if (candidate === 'always') return 'always';
  const seconds = Number(candidate);
  return [60, 120, 240].includes(seconds) ? seconds : 120;
}

function normalizeDisplaySetting(key) {
  return (value) => normalizeWorkoutDisplaySettings({ [key]: value })[key];
}

const GET_READY_OPTIONS = [
  { name: 'Off', value: '0' },
  { name: '3 sec', value: '3' },
  { name: '5 sec', value: '5' },
  { name: '10 sec', value: '10' },
];
const SCREEN_ON_OPTIONS = [
  { name: '60 sec', value: '60' },
  { name: '120 sec', value: '120' },
  { name: '240 sec', value: '240' },
  { name: 'Always', value: 'always' },
];
const API_KEY_STEPS = [
  '1. Open Liftosaur.',
  '2. Go to Settings > API Keys.',
  '3. Copy your personal key.',
  '4. Paste it above and tap Save key.',
];

// Zepp Select shows no current choice on its own, so the label carries it.
function settingSummary(label, options, value) {
  const selected = options.find((option) => option.value === String(value)) || options[0];
  return `${label}: ${selected.name}`;
}

const CARD_STYLE = {
  width: '100%',
  maxWidth: '440px',
  margin: '0 auto 14px',
  padding: '20px 16px',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: '#FFFFFF',
  borderRadius: '16px',
  boxSizing: 'border-box',
};

const STATUS_STYLE = {
  width: '100%',
  padding: '12px',
  marginBottom: '12px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '10px',
  boxSizing: 'border-box',
  textAlign: 'center',
};

const SECTION_TITLE_STYLE = {
  display: 'block',
  width: '100%',
  marginBottom: '8px',
  color: '#6D4AE8',
  fontSize: '20px',
  fontWeight: 'bold',
  textAlign: 'center',
};

const LABEL_STYLE = {
  display: 'block',
  width: '100%',
  color: '#111827',
  fontSize: '16px',
  fontWeight: '600',
  textAlign: 'center',
};

const HELPER_STYLE = {
  display: 'block',
  width: '100%',
  marginBottom: '12px',
  color: '#6B7280',
  fontSize: '15px',
  lineHeight: '20px',
  textAlign: 'center',
};

const BODY_STYLE = {
  display: 'block',
  width: '100%',
  marginBottom: '4px',
  color: '#374151',
  fontSize: '15px',
  lineHeight: '20px',
  textAlign: 'left',
  userSelect: 'text',
  WebkitUserSelect: 'text',
};

function helperText(text) {
  return Text({ paragraph: true, align: 'center', style: HELPER_STYLE }, text);
}

function bodyText(text) {
  return Text({ paragraph: true, align: 'left', style: BODY_STYLE }, text);
}

function withHelper(control, helper) {
  return helper ? [control, helperText(helper)] : [control];
}

function section(title, description, children) {
  return View({ style: CARD_STYLE }, [
    Text({ paragraph: true, align: 'center', style: SECTION_TITLE_STYLE }, title),
    ...(description ? [helperText(description)] : []),
    ...children,
  ]);
}

function diagnosticsReport(stored) {
  const report = formatWorkoutDiagnostics(stored);
  return [
    Text({ paragraph: true, align: 'center', style: LABEL_STYLE }, 'Recent watch steps'),
    helperText('Sent when Lifto connects or resumes.'),
    ...report.split('\n').map(bodyText),
    ...(report !== WORKOUT_DIAGNOSTICS_EMPTY
      ? withHelper(TextInput({
          label: 'Select and copy logs',
          multiline: true,
          value: report,
          rows: 12,
          labelStyle: LABEL_STYLE,
          subStyle: { width: '100%' },
          onChange: () => {
            // Keep selection enabled without saving edits to the diagnostic report.
          },
        }), 'Open the field, then long-press, Select all and Copy.')
      : []),
  ];
}

AppSettingsPage({
  state: {
    apiKey: '',
    screenOnDuration: 120,
    getReadySeconds: 5,
    exerciseImages: false,
    autoPrepare: false,
    showWorkoutProgress: false,
    showPlateBreakdown: true,
    showRestInfo: true,
    workoutDiagnosticsEnabled: false,
  },

  build(props) {
    this.getStorage(props);
    const storage = props.settingsStorage;

    const trimmedKey = (this.state.apiKey || '').trim();
    const hasKey = !isDemoApiKey(trimmedKey) && trimmedKey.length > 5;
    const maskedKey = hasKey
      ? `${trimmedKey.slice(0, 8)}****${trimmedKey.slice(-4)}`
      : 'None';

    // Every control saves its normalized value as a string, the shape all phone and watch readers accept.
    const save = (key, storageKey, value) => {
      this.state[key] = value;
      storage.setItem(storageKey, String(value));
      return value;
    };
    const toggleSetting = ({ label, key, storageKey = key, normalize, helper, onSaved = () => {} }) => withHelper(
      Toggle({
        label,
        value: this.state[key],
        onChange: (value) => onSaved(save(key, storageKey, normalize(value))),
      }),
      helper
    );
    const selectSetting = ({ label, key, options, normalize, helper }) => {
      const value = String(this.state[key]);
      return withHelper(
        Select({
          label: settingSummary(label, options, value),
          value,
          options,
          onChange: (next) => save(key, key, normalize(next)),
        }),
        helper
      );
    };

    return View(
      {
        style: {
          padding: '16px 12px 24px',
          backgroundColor: '#F4F3F8',
          minHeight: '100%',
        },
      },
      [
        section('Connection', null, [
          View(
            {
              style: {
                ...STATUS_STYLE,
                backgroundColor: hasKey ? '#ECFDF5' : '#F5F3FF',
                border: `1px solid ${hasKey ? '#A7F3D0' : '#DDD6FE'}`,
              },
            },
            [
              Text(
                {
                  paragraph: true,
                  align: 'center',
                  style: {
                    display: 'block',
                    width: '100%',
                    marginBottom: '2px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    color: hasKey ? '#065F46' : '#5B43B5',
                    textAlign: 'center',
                  },
                },
                hasKey ? 'Connected to Liftosaur' : 'Demo mode'
              ),
              Text(
                {
                  paragraph: true,
                  align: 'center',
                  style: {
                    display: 'block',
                    width: '100%',
                    fontSize: '15px',
                    color: hasKey ? '#047857' : '#6D4AE8',
                    textAlign: 'center',
                  },
                },
                hasKey ? maskedKey : 'Add an API key to sync your workouts.'
              ),
            ]
          ),
          TextInput({
            label: 'Liftosaur API key',
            labelStyle: LABEL_STYLE,
            placeholder: 'Paste lftsk_... here',
            value: this.state.apiKey,
            settingsKey: 'apiKey',
            subStyle: {
              color: '#6B7280',
              fontSize: '15px',
              textAlign: 'center',
            },
            description: hasKey ? 'Tap to replace your key' : 'Tap to add your key',
            onChange: (val) => {
              const clean = typeof val === 'object' && val !== null ? (val.value || '') : String(val || '');
              this.state.apiKey = clean;
              storage.setItem('apiKey', clean);
            },
          }),
          Button({
            label: 'Save key',
            style: {
              width: '100%',
              marginTop: '12px',
              padding: '12px',
              backgroundColor: '#6D4AE8',
              color: '#FFFFFF',
              borderRadius: '10px',
              fontSize: '17px',
              fontWeight: 'bold',
              textAlign: 'center',
            },
            onClick: () => {
              if (this.state.apiKey) {
                storage.setItem('apiKey', this.state.apiKey.trim());
              }
            },
          }),
          ...(hasKey
            ? [Button({
                label: 'Disconnect',
                style: {
                  width: '100%',
                  marginTop: '8px',
                  padding: '10px',
                  backgroundColor: '#FEF2F2',
                  color: '#B91C1C',
                  border: '1px solid #FECACA',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: '600',
                  textAlign: 'center',
                },
                onClick: () => {
                  this.state.apiKey = '';
                  storage.removeItem('apiKey');
                },
              })]
            : []),
        ]),

        section('Sets and rest', 'Rest timers follow your Liftosaur settings.', [
          ...toggleSetting({
            label: 'Auto prepare',
            key: 'autoPrepare',
            normalize: normalizeAutoPrepare,
            helper: 'Open the next set while rest runs.',
          }),
          ...selectSetting({
            label: 'Ready countdown',
            key: 'getReadySeconds',
            options: GET_READY_OPTIONS,
            normalize: normalizeGetReadySeconds,
            helper: 'Counts down before a timed set starts.',
          }),
        ]),

        section('Workout display', null, [
          ...selectSetting({
            label: 'Screen timeout',
            key: 'screenOnDuration',
            options: SCREEN_ON_OPTIONS,
            normalize: normalizeScreenOnDuration,
          }),
          ...toggleSetting({
            label: 'Exercise images',
            key: 'exerciseImages',
            normalize: normalizeExerciseImages,
            helper: 'Show pictures in the list, Info and Prepare.',
          }),
          ...toggleSetting({
            label: 'Workout progress',
            key: 'showWorkoutProgress',
            normalize: normalizeDisplaySetting('showWorkoutProgress'),
            helper: 'Show completed sets at the top of the watch.',
          }),
          ...toggleSetting({
            label: 'Plate breakdown',
            key: 'showPlateBreakdown',
            normalize: normalizeDisplaySetting('showPlateBreakdown'),
            helper: 'Show plates during rest and while editing a set.',
          }),
          ...toggleSetting({
            label: 'Rest Info button',
            key: 'showRestInfo',
            normalize: normalizeDisplaySetting('showRestInfo'),
            helper: 'Keep exercise details available from the rest preview.',
          }),
        ]),

        section('Diagnostics', null, [
          ...toggleSetting({
            label: 'Record watch diagnostics',
            key: 'workoutDiagnosticsEnabled',
            storageKey: WORKOUT_DIAGNOSTICS_ENABLED_KEY,
            normalize: normalizeWorkoutDiagnosticsEnabled,
            helper: 'Open this Lifto app on the watch to apply the change.',
            onSaved: (enabled) => {
              if (!enabled) storage.removeItem(WORKOUT_DIAGNOSTICS_KEY);
            },
          }),
          ...(this.state.workoutDiagnosticsEnabled ? diagnosticsReport(storage.getItem(WORKOUT_DIAGNOSTICS_KEY)) : []),
        ]),

        section('Help', 'Find your API key in Liftosaur.', API_KEY_STEPS.map(bodyText)),
      ]
    );
  },

  getStorage(props) {
    Object.assign(this.state, normalizeWorkoutDisplaySettings({
      showWorkoutProgress: props.settingsStorage.getItem('showWorkoutProgress'),
      showPlateBreakdown: props.settingsStorage.getItem('showPlateBreakdown'),
      showRestInfo: props.settingsStorage.getItem('showRestInfo'),
    }));
    this.state.exerciseImages = normalizeExerciseImages(props.settingsStorage.getItem('exerciseImages'));
    this.state.autoPrepare = normalizeAutoPrepare(props.settingsStorage.getItem('autoPrepare'));
    this.state.workoutDiagnosticsEnabled = normalizeWorkoutDiagnosticsEnabled(
      props.settingsStorage.getItem(WORKOUT_DIAGNOSTICS_ENABLED_KEY)
    );
    const raw = props.settingsStorage.getItem('apiKey');
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        this.state.apiKey = typeof parsed === 'string' ? parsed : (parsed?.value || raw);
      } catch (e) {
        this.state.apiKey = raw;
      }
    } else if (typeof raw === 'object' && raw !== null) {
      this.state.apiKey = raw.value || '';
    } else {
      this.state.apiKey = '';
    }
    this.state.screenOnDuration = normalizeScreenOnDuration(
      props.settingsStorage.getItem('screenOnDuration')
    );
    this.state.getReadySeconds = normalizeGetReadySeconds(
      props.settingsStorage.getItem('getReadySeconds')
    );
  },
});
