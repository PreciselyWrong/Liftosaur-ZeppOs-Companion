AppSettingsPage({
  state: {
    apiKey: '',
  },

  build(props) {
    this.state.apiKey = props.settingsStorage.getItem('apiKey') || '';

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
          description: 'Paste your personal API key (starts with lftsk_)',
          onChange: (val) => {
            props.settingsStorage.setItem('apiKey', val);
            this.state.apiKey = val;
          },
        }),
        Text({
          style: {
            color: '#555555',
            fontSize: '13px',
            marginTop: '12px',
            lineHeight: '18px',
          },
          value: 'How to get your API Key: Open liftosaur.com or the Liftosaur app -> Settings -> API Key.',
        }),
      ]
    );
  },
});
