import { AppSettingsPage, TextInput, View, Text, Section } from '@zeppos/zml/settings';

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
                color: '#888888',
                marginTop: '12px',
              },
              value: 'To get your API key: Open liftosaur.com or the Liftosaur App -> Settings -> API Key.',
            }),
          ]
        ),
      ]
    );
  },
});
