import 'source-map-support/register';

import { ManagedExtension } from 'airdcpp-extension';
import Entry from './main';


// Entry point that is executed by the extension manager
ManagedExtension(Entry, {
  // Possible custom options for airdcpp-apisocket can be listed here
});
