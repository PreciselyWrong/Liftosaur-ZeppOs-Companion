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
              marginBottom: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            },
          },
          [
            Text({
              style: {
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#111827',
                marginBottom: '4px',
              },
              value: 'Liftosaur Cloud Sync',
            }),
            Text({
              style: {
                fontSize: '13px',
                color: '#6B7280',
                marginBottom: '12px',
              },
              value: 'Sync your workouts with Liftosaur Cloud',
            }),
            View(
              {
                style: {
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: '8px 12px',
                  backgroundColor: hasKey ? '#ECFDF5' : '#FFFBEB',
                  borderRadius: '8px',
                  border: `1px solid ${hasKey ? '#A7F3D0' : '#FDE68A'}`,
                },
              },
              [
                Text({
                  style: {
                    fontSize: '13px',
                    fontWeight: '600',
                    color: hasKey ? '#065F46' : '#92400E',
                  },
                  value: hasKey
                    ? `✓ Connected (${maskedKey})`
                    : '⚠ Not connected (API Key required)',
                }),
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
              marginBottom: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            },
          },
          [
            Text({
              style: {
                fontSize: '12px',
                fontWeight: '700',
                letterSpacing: '0.5px',
                color: '#8356F6',
                textTransform: 'uppercase',
                marginBottom: '6px',
              },
              value: 'API KEY CONFIGURATION',
            }),
            Text({
              style: {
                fontSize: '13px',
                color: '#4B5563',
                marginBottom: '8px',
              },
              value: 'Tap the box below to paste or edit your personal key:',
            }),
            TextInput({
              label: 'API Key Field (Tap to edit)',
              labelStyle: {
                color: '#111827',
                fontSize: '15px',
                fontWeight: '600',
              },
              placeholder: 'lftsk_...',
              value: this.state.apiKey,
              settingsKey: 'apiKey',
              subStyle: {
                color: '#6B7280',
                fontSize: '12px',
              },
              description: hasKey
                ? 'Tap here to change or replace your key'
                : 'Tap here to open keyboard and paste your key',
              onChange: (val) => {
                const clean = typeof val === 'object' && val !== null ? (val.value || '') : String(val || '');
                this.state.apiKey = clean;
                props.settingsStorage.setItem('apiKey', clean);
              },
            }),
            Button({
              label: 'Save & Synchronize',
              style: {
                marginTop: '16px',
                backgroundColor: '#8356F6',
                color: '#FFFFFF',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: 'bold',
                padding: '12px',
              },
              onClick: () => {
                if (this.state.apiKey) {
                  props.settingsStorage.setItem('apiKey', this.state.apiKey.trim());
                }
              },
            }),
            hasKey
              ? Button({
                  label: 'Clear / Disconnect Key',
                  style: {
                    marginTop: '10px',
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
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            },
          },
          [
            Text({
              style: {
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#111827',
                marginBottom: '8px',
              },
              value: 'How to get your API Key',
            }),
            Text({
              style: {
                fontSize: '13px',
                color: '#4B5563',
                lineHeight: '20px',
              },
              value:
                '1. Open liftosaur.com (or the Liftosaur App)\n' +
                '2. Go to Settings > API Keys\n' +
                '3. Create or copy your personal key\n' +
                '4. Tap the field above, paste the key, and save',
            }),
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

