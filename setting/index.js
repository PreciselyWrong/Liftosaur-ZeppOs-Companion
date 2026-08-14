AppSettingsPage({
  state: {
    apiKey: '',
  },

  build(props) {
    this.getStorage(props);

    return Section({
      title: 'Liftosaur Account',
      children: [
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
      ],
    });
  },

  getStorage(props) {
    this.state.apiKey = props.settingsStorage.getItem('apiKey') || '';
  },
});
