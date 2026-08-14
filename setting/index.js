AppSettingsPage({
  state: {
    apiKey: '',
  },

  build(props) {
    this.state.apiKey = props.settingsStorage.getItem('apiKey') || '';

    return View(
      {
        style: {
          padding: '16px',
          backgroundColor: '#0C0819',
          minHeight: '100vh',
        },
      },
      [
        Section(
          {
            title: 'Liftosaur Account',
            description: 'Connect with your Liftosaur Cloud account',
          },
          [
            TextInput({
              label: 'API Key',
              placeholder: 'lftsk_...',
              value: this.state.apiKey,
              settingsKey: 'apiKey',
              onChange: (val) => {
                props.settingsStorage.setItem('apiKey', val);
                this.state.apiKey = val;
              },
            }),
            Text({
              style: {
                fontSize: '13px',
                color: '#A4B0BC',
                marginTop: '12px',
              },
              value: 'Find your API Key on liftosaur.com -> Settings -> API Keys (or in the mobile Liftosaur app).',
            }),
          ]
        ),
      ]
    );
  },
});
