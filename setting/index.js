AppSettingsPage({
  state: {
    apiKey: '',
  },

  build(props) {
    this.getStorage(props);

    const hasKey = Boolean(this.state.apiKey && this.state.apiKey.trim().length > 5);
    const trimmedKey = (this.state.apiKey || '').trim();
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
                  fontSize: '18px',
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
                  fontSize: '13px',
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
                      fontSize: '13px',
                      fontWeight: '600',
                      color: hasKey ? '#065F46' : '#92400E',
                      textAlign: 'center',
                    },
                  },
                  hasKey
                    ? `✓ Status: Connected\n(${maskedKey})`
                    : '● Status: Demo mode\nSample program, nothing is saved.\nAdd a key below to use your account.'
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
                  fontSize: '12px',
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
                  fontSize: '13px',
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
                    fontSize: '15px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    width: '100%',
                  },
                  placeholder: 'Paste lftsk_... here',
                  value: this.state.apiKey,
                  settingsKey: 'apiKey',
                  subStyle: {
                    color: '#6B7280',
                    fontSize: '13px',
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
                fontSize: '15px',
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
                    fontSize: '14px',
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

        // Default Rest Timers Card
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
                  fontSize: '12px',
                  fontWeight: 'bold',
                  color: '#8356F6',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                  textAlign: 'center',
                },
              },
              'DEFAULT REST TIMERS'
            ),
            Text(
              {
                paragraph: true,
                align: 'center',
                style: {
                  display: 'block',
                  width: '100%',
                  fontSize: '13px',
                  color: '#4B5563',
                  marginBottom: '14px',
                  textAlign: 'center',
                },
              },
              'Used when a program or exercise does not define an explicit timer (e.g. standard GZCLP T1/T2):'
            ),
            // Standard Rest Input & Presets
            View(
              {
                style: {
                  width: '100%',
                  marginBottom: '16px',
                },
              },
              [
                TextInput({
                  label: 'Standard Set Rest (seconds)',
                  labelStyle: {
                    color: '#111827',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    width: '100%',
                  },
                  placeholder: '120 (0 = Off)',
                  value: this.state.defaultStandardRest || '120',
                  settingsKey: 'defaultStandardRest',
                  description: `Current: ${this.state.defaultStandardRest === '0' ? 'Off' : (this.state.defaultStandardRest || '120') + 's'}`,
                  onChange: (val) => {
                    const clean = typeof val === 'object' && val !== null ? (val.value || '') : String(val || '');
                    this.state.defaultStandardRest = clean;
                    props.settingsStorage.setItem('defaultStandardRest', clean);
                  },
                }),
                View(
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: '6px',
                      marginTop: '6px',
                      flexWrap: 'wrap',
                    },
                  },
                  [
                    Button({
                      label: '60s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultStandardRest = '60'; props.settingsStorage.setItem('defaultStandardRest', '60'); },
                    }),
                    Button({
                      label: '90s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultStandardRest = '90'; props.settingsStorage.setItem('defaultStandardRest', '90'); },
                    }),
                    Button({
                      label: '120s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultStandardRest = '120'; props.settingsStorage.setItem('defaultStandardRest', '120'); },
                    }),
                    Button({
                      label: '180s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultStandardRest = '180'; props.settingsStorage.setItem('defaultStandardRest', '180'); },
                    }),
                    Button({
                      label: 'Off',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#F3F4F6', color: '#4B5563', borderRadius: '6px' },
                      onClick: () => { this.state.defaultStandardRest = '0'; props.settingsStorage.setItem('defaultStandardRest', '0'); },
                    }),
                  ]
                ),
              ]
            ),

            // Warmup Rest Input & Presets
            View(
              {
                style: {
                  width: '100%',
                  marginBottom: '16px',
                },
              },
              [
                TextInput({
                  label: 'Warmup Set Rest (seconds)',
                  labelStyle: {
                    color: '#111827',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    width: '100%',
                  },
                  placeholder: '60 (0 = Off)',
                  value: this.state.defaultWarmupRest || '60',
                  settingsKey: 'defaultWarmupRest',
                  description: `Current: ${this.state.defaultWarmupRest === '0' ? 'Off' : (this.state.defaultWarmupRest || '60') + 's'}`,
                  onChange: (val) => {
                    const clean = typeof val === 'object' && val !== null ? (val.value || '') : String(val || '');
                    this.state.defaultWarmupRest = clean;
                    props.settingsStorage.setItem('defaultWarmupRest', clean);
                  },
                }),
                View(
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: '6px',
                      marginTop: '6px',
                      flexWrap: 'wrap',
                    },
                  },
                  [
                    Button({
                      label: '30s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultWarmupRest = '30'; props.settingsStorage.setItem('defaultWarmupRest', '30'); },
                    }),
                    Button({
                      label: '45s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultWarmupRest = '45'; props.settingsStorage.setItem('defaultWarmupRest', '45'); },
                    }),
                    Button({
                      label: '60s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultWarmupRest = '60'; props.settingsStorage.setItem('defaultWarmupRest', '60'); },
                    }),
                    Button({
                      label: '90s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultWarmupRest = '90'; props.settingsStorage.setItem('defaultWarmupRest', '90'); },
                    }),
                    Button({
                      label: 'Off',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#F3F4F6', color: '#4B5563', borderRadius: '6px' },
                      onClick: () => { this.state.defaultWarmupRest = '0'; props.settingsStorage.setItem('defaultWarmupRest', '0'); },
                    }),
                  ]
                ),
              ]
            ),

            // Superset Rest Input & Presets
            View(
              {
                style: {
                  width: '100%',
                },
              },
              [
                TextInput({
                  label: 'Superset Rest (seconds)',
                  labelStyle: {
                    color: '#111827',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    textAlign: 'center',
                    width: '100%',
                  },
                  placeholder: '90 (0 = Off)',
                  value: this.state.defaultSupersetRest || '90',
                  settingsKey: 'defaultSupersetRest',
                  description: `Current: ${this.state.defaultSupersetRest === '0' ? 'Off' : (this.state.defaultSupersetRest || '90') + 's'}`,
                  onChange: (val) => {
                    const clean = typeof val === 'object' && val !== null ? (val.value || '') : String(val || '');
                    this.state.defaultSupersetRest = clean;
                    props.settingsStorage.setItem('defaultSupersetRest', clean);
                  },
                }),
                View(
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: '6px',
                      marginTop: '6px',
                      flexWrap: 'wrap',
                    },
                  },
                  [
                    Button({
                      label: '30s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultSupersetRest = '30'; props.settingsStorage.setItem('defaultSupersetRest', '30'); },
                    }),
                    Button({
                      label: '60s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultSupersetRest = '60'; props.settingsStorage.setItem('defaultSupersetRest', '60'); },
                    }),
                    Button({
                      label: '90s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultSupersetRest = '90'; props.settingsStorage.setItem('defaultSupersetRest', '90'); },
                    }),
                    Button({
                      label: '120s',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#EDE9FE', color: '#6D28D9', borderRadius: '6px' },
                      onClick: () => { this.state.defaultSupersetRest = '120'; props.settingsStorage.setItem('defaultSupersetRest', '120'); },
                    }),
                    Button({
                      label: 'Off',
                      style: { fontSize: '12px', padding: '6px 10px', backgroundColor: '#F3F4F6', color: '#4B5563', borderRadius: '6px' },
                      onClick: () => { this.state.defaultSupersetRest = '0'; props.settingsStorage.setItem('defaultSupersetRest', '0'); },
                    }),
                  ]
                ),
              ]
            ),
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
                  fontSize: '14px',
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
                  fontSize: '13px',
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

    const parseRest = (key, defaultVal) => {
      const item = props.settingsStorage.getItem(key);
      if (typeof item === 'string') {
        try {
          const parsed = JSON.parse(item);
          return typeof parsed === 'string' || typeof parsed === 'number'
            ? String(parsed)
            : String(parsed?.value ?? defaultVal);
        } catch (e) {
          return item;
        }
      } else if (typeof item === 'object' && item !== null) {
        return String(item.value ?? defaultVal);
      }
      return defaultVal;
    };

    this.state.defaultStandardRest = parseRest('defaultStandardRest', '120');
    this.state.defaultWarmupRest = parseRest('defaultWarmupRest', '60');
    this.state.defaultSupersetRest = parseRest('defaultSupersetRest', '90');
  },
});

