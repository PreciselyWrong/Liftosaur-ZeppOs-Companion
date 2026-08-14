AppSettingsPage({
  state: {
    apiKey: '',
  },

  build(props) {
    this.getStorage(props);

    return Section(
      {
        title: 'Liftosaur Settings',
        description: 'Connect with your Liftosaur Cloud account',
      },
      [
        TextInput({
          label: 'API Key',
          labelStyle: {
            color: '#8356F6',
            fontSize: '16px',
            fontWeight: 'bold',
          },
          placeholder: 'lftsk_...',
          value: this.state.apiKey,
          settingsKey: 'apiKey',
          subStyle: {
            color: '#777777',
            fontSize: '12px',
          },
          description: 'Paste your Liftosaur personal API key',
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
            borderRadius: '10px',
            fontSize: '15px',
            fontWeight: 'bold',
          },
          onClick: () => {
            if (this.state.apiKey) {
              props.settingsStorage.setItem('apiKey', this.state.apiKey.trim());
            }
          },
        }),
        Text({
          style: {
            color: '#555555',
            fontSize: '13px',
            marginTop: '14px',
            lineHeight: '18px',
          },
          value: 'To find your API Key:\n1. Open liftosaur.com (or the Liftosaur App)\n2. Go to Settings > API Keys\n3. Copy your key and paste it above.',
        }),
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
