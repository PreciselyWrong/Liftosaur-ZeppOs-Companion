AppSettingsPage({
  state: {
    apiKey: '',
  },

  build(props) {
    this.state.apiKey = props.settingsStorage.getItem('apiKey') || '';

    return Section(
      {
        title: 'Liftosaur Account',
        description: 'Enter your Liftosaur API Key to sync workouts',
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
      ]
    );
  },
});
