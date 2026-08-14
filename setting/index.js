AppSettingsPage({
  build(props) {
    return Section(
      {
        title: 'Liftosaur Account',
        description: 'Sync with Liftosaur Cloud',
      },
      [
        TextInput({
          label: 'API Key',
          settingsKey: 'apiKey',
          placeholder: 'lftsk_...',
          labelStyle: {
            color: '#111111',
            fontSize: '15px',
            fontWeight: 'bold',
          },
          subStyle: {
            color: '#666666',
            fontSize: '12px',
          },
          description: 'Paste your API key (starts with lftsk_)',
        }),
        Text({
          style: {
            color: '#555555',
            fontSize: '13px',
            marginTop: '12px',
            lineHeight: '18px',
          },
          value: 'How to find your key: Open liftosaur.com or the Liftosaur app -> Settings -> API Keys.',
        }),
      ]
    );
  },
});
