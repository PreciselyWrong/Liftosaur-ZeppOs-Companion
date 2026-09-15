import { normalizeGetReadySeconds } from '../shared/timed-settings.js';
import { normalizeExerciseImages } from '../shared/exercise-images.js';

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

const GET_READY_OPTIONS = [
  { name: 'Off', value: '0' },
  { name: '3 sec', value: '3' },
  { name: '5 sec', value: '5' },
  { name: '10 sec', value: '10' },
];
const EXERCISE_IMAGE_OPTIONS = [
  { name: 'Off', value: 'false' },
  { name: 'On', value: 'true' },
];
const SCREEN_ON_OPTIONS = [
  { name: '60 sec', value: '60' },
  { name: '120 sec', value: '120' },
  { name: '240 sec', value: '240' },
  { name: 'Always', value: 'always' },
];

function selectedOptionName(options, value) {
  const selected = options.find((option) => option.value === String(value));
  return selected ? selected.name : options[0].name;
}

function settingSummary(label, options, value) {
  return `${label}: ${selectedOptionName(options, value)}`;
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

function settingsHeading(title, description) {
  return View(
    {
      style: {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        marginBottom: '12px',
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
            marginBottom: '4px',
            color: '#6D4AE8',
            fontSize: '20px',
            fontWeight: 'bold',
            textAlign: 'center',
          },
        },
        title
      ),
      Text(
        {
          paragraph: true,
          align: 'center',
          style: {
            display: 'block',
            width: '100%',
            maxWidth: '360px',
            color: '#6B7280',
            fontSize: '15px',
            lineHeight: '20px',
            textAlign: 'center',
          },
        },
        description
      ),
    ]
  );
}

AppSettingsPage({
  state: {
    apiKey: '',
    screenOnDuration: 120,
    getReadySeconds: 5,
    exerciseImages: false,
  },

  build(props) {
    this.getStorage(props);

    const trimmedKey = (this.state.apiKey || '').trim();
    const hasKey = !isDemoApiKey(trimmedKey) && trimmedKey.length > 5;
    const maskedKey = hasKey
      ? `${trimmedKey.slice(0, 8)}****${trimmedKey.slice(-4)}`
      : 'None';
    const getReadyValue = String(this.state.getReadySeconds);
    const exerciseImagesValue = String(this.state.exerciseImages);
    const screenOnValue = String(this.state.screenOnDuration);

    return View(
      {
        style: {
          padding: '16px 12px 24px',
          backgroundColor: '#F4F3F8',
          minHeight: '100%',
        },
      },
      [
        View(
          {
            style: CARD_STYLE,
          },
          [
            settingsHeading('Lifto Companion', 'Liftosaur workouts on your Amazfit.'),
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
              labelStyle: {
                width: '100%',
                color: '#111827',
                fontSize: '16px',
                fontWeight: '600',
                textAlign: 'center',
              },
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
                props.settingsStorage.setItem('apiKey', clean);
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
                  props.settingsStorage.setItem('apiKey', this.state.apiKey.trim());
                }
              },
            }),
            hasKey
              ? Button({
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
                    props.settingsStorage.removeItem('apiKey');
                  },
                })
              : null,
          ].filter(Boolean)
        ),

        View(
          {
            style: CARD_STYLE,
          },
          [
            settingsHeading('Workout settings', 'Tune what happens on your watch.'),
            Select({
              label: settingSummary('Ready countdown', GET_READY_OPTIONS, getReadyValue),
              value: getReadyValue,
              options: GET_READY_OPTIONS,
              onChange: (value) => {
                const seconds = normalizeGetReadySeconds(value);
                this.state.getReadySeconds = seconds;
                props.settingsStorage.setItem('getReadySeconds', String(seconds));
              },
            }),
            Select({
              label: settingSummary('Exercise images', EXERCISE_IMAGE_OPTIONS, exerciseImagesValue),
              value: exerciseImagesValue,
              options: EXERCISE_IMAGE_OPTIONS,
              onChange: (value) => {
                this.state.exerciseImages = normalizeExerciseImages(value);
                props.settingsStorage.setItem('exerciseImages', String(this.state.exerciseImages));
              },
            }),
            Select({
              label: settingSummary('Screen timeout', SCREEN_ON_OPTIONS, screenOnValue),
              value: screenOnValue,
              options: SCREEN_ON_OPTIONS,
              onChange: (value) => {
                const duration = normalizeScreenOnDuration(value);
                this.state.screenOnDuration = duration;
                props.settingsStorage.setItem('screenOnDuration', String(duration));
              },
            }),
            View(
              {
                style: {
                  width: '100%',
                  marginTop: '10px',
                  padding: '10px 12px',
                  backgroundColor: '#F5F3FF',
                  borderRadius: '10px',
                  boxSizing: 'border-box',
                },
              },
              Text(
                {
                  paragraph: true,
                  align: 'center',
                  style: {
                    width: '100%',
                    color: '#5B43B5',
                    fontSize: '15px',
                    lineHeight: '18px',
                    textAlign: 'center',
                  },
                },
                'Rest timers follow your Liftosaur settings.'
              )
            ),
          ]
        ),

        View(
          {
            style: CARD_STYLE,
          },
          [
            settingsHeading('Account help', 'Find your API key in Liftosaur.'),
            Text(
              {
                paragraph: true,
                align: 'left',
                style: {
                  display: 'block',
                  width: '100%',
                  fontSize: '16px',
                  color: '#374151',
                  lineHeight: '24px',
                  textAlign: 'left',
                  whiteSpace: 'pre-line',
                },
              },
              '1. Open Liftosaur.\n2. Go to Settings > API Keys.\n3. Copy your personal key.\n4. Paste it above and tap Save key.'
            ),
          ]
        ),
      ]
    );
  },

  getStorage(props) {
    this.state.exerciseImages = normalizeExerciseImages(props.settingsStorage.getItem('exerciseImages'));
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
