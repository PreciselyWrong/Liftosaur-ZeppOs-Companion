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
            },
          },
          [
            Text(
              {
                style: {
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: '#111827',
                  marginBottom: '4px',
                },
              },
              'Liftosaur Cloud Sync'
            ),
            Text(
              {
                style: {
                  fontSize: '13px',
                  color: '#6B7280',
                  marginBottom: '12px',
                },
              },
              'Sync workouts with your Liftosaur account'
            ),
            View(
              {
                style: {
                  padding: '10px 12px',
                  backgroundColor: hasKey ? '#ECFDF5' : '#FFFBEB',
                  borderRadius: '8px',
                  border: `1px solid ${hasKey ? '#A7F3D0' : '#FDE68A'}`,
                },
              },
              [
                Text(
                  {
                    style: {
                      fontSize: '13px',
                      fontWeight: '600',
                      color: hasKey ? '#065F46' : '#92400E',
                    },
                  },
                  hasKey
                    ? `✓ Status: Connected (${maskedKey})`
                    : '⚠ Status: Not connected (API Key required)'
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
            },
          },
          [
            Text(
              {
                style: {
                  fontSize: '12px',
                  fontWeight: 'bold',
                  color: '#8356F6',
                  textTransform: 'uppercase',
                  marginBottom: '6px',
                },
              },
              'API KEY'
            ),
            Text(
              {
                style: {
                  fontSize: '13px',
                  color: '#4B5563',
                  marginBottom: '10px',
                },
              },
              'Tap the box below to edit or paste your API key:'
            ),
            TextInput({
              label: 'API Key (Tap to edit)',
              labelStyle: {
                color: '#111827',
                fontSize: '15px',
                fontWeight: 'bold',
              },
              placeholder: 'Paste lftsk_... here',
              value: this.state.apiKey,
              settingsKey: 'apiKey',
              subStyle: {
                color: '#6B7280',
                fontSize: '13px',
              },
              description: hasKey
                ? 'Tap here to replace or edit your key'
                : 'Tap here to enter your key',
              onChange: (val) => {
                const clean = typeof val === 'object' && val !== null ? (val.value || '') : String(val || '');
                this.state.apiKey = clean;
                props.settingsStorage.setItem('apiKey', clean);
              },
            }),
            Button({
              label: 'Save Key',
              style: {
                marginTop: '14px',
                backgroundColor: '#8356F6',
                color: '#FFFFFF',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 'bold',
                padding: '10px',
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
                    marginTop: '8px',
                    backgroundColor: '#FEF2F2',
                    color: '#DC2626',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    border: '1px solid #FECACA',
                  },
                  onClick: () => {
                    this.state.apiKey = '';
                    props.settingsStorage.removeItem('apiKey');
                  },
                })
              : null,
          ].filter(Boolean)
        ),

        // How-to Guide Card
        View(
          {
            style: {
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '16px',
            },
          },
          [
            Text(
              {
                style: {
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: '#111827',
                  marginBottom: '8px',
                },
              },
              'How to find your API Key'
            ),
            Text(
              {
                style: {
                  fontSize: '13px',
                  color: '#4B5563',
                  lineHeight: '19px',
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
  },
});

