import { AppSettingsPage, Section, TextInput, Text } from '@zeppos/zeus-app-sdk/settings';

AppSettingsPage({
  build(props) {
    return [
      Section(
        {
          title: 'Liftosaur Account',
          description: 'Sync your custom programs and workouts with Liftosaur Cloud.',
        },
        [
          TextInput({
            label: 'API Key',
            settingsKey: 'apiKey',
            placeholder: 'lftsk_...',
            subStyle: {
              color: '#333333',
            },
          }),
          Text({
            style: {
              fontSize: '12px',
              color: '#888888',
              marginTop: '8px',
            },
            value: 'To obtain your API key: Open liftosaur.com or the Liftosaur App -> Settings -> API Key.',
          }),
        ]
      ),
    ];
  },
});
