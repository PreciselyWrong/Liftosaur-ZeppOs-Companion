AppSettingsPage({
  state: {
    apiKey: '',
  },

  build(props) {
    this.getStorage(props);

    return Section(
      {
        title: 'Liftosaur Account',
        description: 'Connect with your Liftosaur Cloud account',
      },
      [
        TextInput({
          label: 'API Key',
          labelStyle: {
            color: '#111111',
            fontSize: '15px',
            fontWeight: 'bold',
          },
          placeholder: 'lftsk_...',
          value: this.state.apiKey,
          settingsKey: 'apiKey',
          subStyle: {
            color: '#666666',
            fontSize: '12px',
          },
          description: 'Personal API key starting with lftsk_',
          onChange: (val) => {
            const clean = typeof val === 'object' && val !== null ? (val.value || '') : String(val || '');
            this.state.apiKey = clean;
            props.settingsStorage.setItem('apiKey', clean);
          },
        }),
        Button({
          label: 'Save API Key',
          style: {
            marginTop: '16px',
            backgroundColor: '#8356F6',
            color: '#FFFFFF',
            borderRadius: '8px',
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
          value: 'To get your API Key: Open liftosaur.com -> Settings -> API Keys (or in the mobile Liftosaur app).',
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
