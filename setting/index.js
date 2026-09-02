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

AppSettingsPage({
  state: {
    apiKey: '',
    screenOnDuration: 120,
  },

  build(props) {
    this.getStorage(props);

    const trimmedKey = (this.state.apiKey || '').trim();
    const hasKey = !isDemoApiKey(trimmedKey) && trimmedKey.length > 5;
    const maskedKey = hasKey
      ? `${trimmedKey.slice(0, 8)}••••${trimmedKey.slice(-4)}`
      : 'None';

    return View(
      {
        style: {
          padding: '16px',
          backgroundColor: '#F3F4F6',
          minHeight: '100%',
        },
      },
      [
        // Header & Status Card
        View(
          {
            style: {
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
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
                  fontSize: '22px',
                  fontWeight: 'bold',
                  color: '#111827',
                  marginBottom: '4px',
                  textAlign: 'center',
                },
              },
              'Liftosaur Cloud Sync'
            ),
            Text(
              {
                paragraph: true,
                align: 'center',
                style: {
                  display: 'block',
                  width: '100%',
                  fontSize: '16px',
                  color: '#6B7280',
                  marginBottom: '12px',
                  textAlign: 'center',
                },
              },
              'Sync workouts with your Liftosaur account'
            ),
            View(
              {
                style: {
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: hasKey ? '#ECFDF5' : '#FFFBEB',
                  borderRadius: '8px',
                  border: `1px solid ${hasKey ? '#A7F3D0' : '#FDE68A'}`,
                  textAlign: 'center',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
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
                      fontSize: '16px',
                      fontWeight: '600',
                      color: hasKey ? '#065F46' : '#92400E',
                      textAlign: 'center',
                    },
                  },
                  hasKey
                    ? `✓ Status: Connected\n(${maskedKey})`
                    : '● Status: Demo mode\nNo Liftosaur account is connected.\nSample workouts stay off Liftosaur.\nAdd an API key below for Cloud sync.'
                ),
              ]
            ),
          ]
        ),

        // API Key Input Card
        View(
          {
            style: {
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
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
                  fontSize: '17px',
                  fontWeight: 'bold',
                  color: '#8356F6',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                  textAlign: 'center',
                },
              },
              'API KEY'
            ),
            Text(
              {
                paragraph: true,
                align: 'center',
                style: {
                  display: 'block',
                  width: '100%',
                  fontSize: '16px',
                  color: '#4B5563',
                  marginBottom: '12px',
                  textAlign: 'center',
                },
              },
              'Tap the box below to edit or paste your API key:'
            ),
            View(
              {
                style: {
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  textAlign: 'center',
                },
              },
              [
                TextInput({
                  label: 'API Key (Tap to edit)',
                  labelStyle: {
                    color: '#111827',
                    fontSize: '17px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    width: '100%',
                  },
                  placeholder: 'Paste lftsk_... here',
                  value: this.state.apiKey,
                  settingsKey: 'apiKey',
                  subStyle: {
                    color: '#6B7280',
                    fontSize: '16px',
                    textAlign: 'center',
                  },
                  description: hasKey
                    ? 'Tap to replace or edit your key'
                    : 'Tap to enter your key',
                  onChange: (val) => {
                    const clean = typeof val === 'object' && val !== null ? (val.value || '') : String(val || '');
                    this.state.apiKey = clean;
                    props.settingsStorage.setItem('apiKey', clean);
                  },
                }),
              ]
            ),
            Button({
              label: 'Save Key',
              style: {
                width: '100%',
                marginTop: '14px',
                backgroundColor: '#8356F6',
                color: '#FFFFFF',
                borderRadius: '8px',
                fontSize: '17px',
                fontWeight: 'bold',
                padding: '12px',
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
                  label: 'Disconnect / Clear Key',
                  style: {
                    width: '100%',
                    marginTop: '8px',
                    backgroundColor: '#FEF2F2',
                    color: '#DC2626',
                    borderRadius: '8px',
                    fontSize: '17px',
                    fontWeight: '600',
                    border: '1px solid #FECACA',
                    padding: '10px',
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

        // Rest Timers Info Card
        View(
          {
            style: {
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
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
                  fontSize: '17px',
                  fontWeight: 'bold',
                  color: '#8356F6',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                  textAlign: 'center',
                },
              },
              'REST TIMERS'
            ),
            Text(
              {
                paragraph: true,
                align: 'center',
                style: {
                  display: 'block',
                  width: '100%',
                  fontSize: '16px',
                  color: '#4B5563',
                  textAlign: 'center',
                },
              },
              'Rest timers follow your Liftosaur settings.'
            ),
          ]
        ),

        View(
          {
            style: {
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '14px',
              display: 'flex',
              flexDirection: 'column',
            },
          },
          [
            Text(
              {
                paragraph: true,
                style: {
                  fontSize: '17px',
                  fontWeight: 'bold',
                  color: '#8356F6',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                },
              },
              'WORKOUT DISPLAY'
            ),
            Text(
              {
                paragraph: true,
                style: {
                  fontSize: '16px',
                  color: '#4B5563',
                  marginBottom: '10px',
                },
              },
              'Keep Lifto visible while you train.'
            ),
            Select({
              label: 'Screen stays on',
              value: String(this.state.screenOnDuration),
              options: [
                { name: '60 seconds', value: '60' },
                { name: '120 seconds', value: '120' },
                { name: '240 seconds', value: '240' },
                { name: 'Always', value: 'always' },
              ],
              onChange: (value) => {
                const duration = normalizeScreenOnDuration(value);
                this.state.screenOnDuration = duration;
                props.settingsStorage.setItem('screenOnDuration', duration);
              },
            }),
          ]
        ),

        // How-to Guide Card
        View(
          {
            style: {
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
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
                  fontSize: '17px',
                  fontWeight: 'bold',
                  color: '#111827',
                  marginBottom: '10px',
                  textAlign: 'center',
                },
              },
              'How to find your API Key'
            ),
            Text(
              {
                paragraph: true,
                align: 'center',
                style: {
                  display: 'block',
                  width: '100%',
                  fontSize: '16px',
                  color: '#4B5563',
                  lineHeight: '20px',
                  textAlign: 'center',
                  whiteSpace: 'pre-line',
                },
              },
              '1. Open liftosaur.com or the Liftosaur app\n2. Go to Settings > API Keys\n3. Copy your personal API key\n4. Tap the API Key box above to paste it'
            ),
          ]
        ),
      ]
    );
  },

  getStorage(props) {
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
  },
});
