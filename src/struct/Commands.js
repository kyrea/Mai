const moment = require('moment');
const { Collection } = require('discord.js');
const { basename, join } = require('path');
const { readdirSync } = require('fs');
const Command = require('./Command');

module.exports = class Commands{
  constructor(client){

    /**
     * The client that instantiated this Manager
     * @name CommandManager#client
     * @type {MaiClient}
     * @readonly
     */
    Object.defineProperty(this, 'client', { value: client });

    this.store = new Collection();

  };

  /**
  * Adds a new command to the handler
  * @param {Command} command The command to add
  * @returns {CommandManager} This instance
  */
  add(command, path){
    if (!(command instanceof Command)){
      command = new Command(this.client, command, path);
    };

    if (command.cooldown.time){
      command.cooldown.users = new Collection();
    };

    this.store.set(command.name, command);
    return this;
  };

  /**
  * Gets a command
  * @param {query<CommandName|CommandAlias>}  query !uery of the Command to get
  * @returns {?Command} The loaded command object
  */
  get(query){
    const command = this.store.get(query) || this.store.find(x => x.aliases.includes(query));
    if (command) command.used++;
    return command;
  };

  /**
  *
  * queries commands via group(s)
  * @param {string<CommandGroup(s)>} group(s) The command group(s) to fetch
  * @returns {Collection<Command>} Collection of commands
  */
  getCommandsByGroup(...groups){
    if (!groups?.length) groups = this.groups;
    return this.store.filter(x => groups.includes(x));
  };

  async handle(message, langservices){

    if (message.guild && !message.channel.permissionsFor(message.guild.me).has('SEND_MESSAGES')){
      return Promise.resolve({ executed: false, reason: 'PERMISSION_SEND' })
    };

    let serverprefix = message.guild.profile?.prefix || message.client.prefix, prefix;

    if (message.content.startsWith('mai')){
      prefix = 'mai';
    } else if (message.content.startsWith(message.client.prefix)){
      prefix = message.client.prefix;
    } else {
      prefix = serverprefix;
    };

    if (!prefix){
      return Promise.resolve({ executed: false, reason: 'PREFIX' });
    };

    const [ name, ...args ] = message.content.slice(prefix.length).split(/ +/).filter(Boolean);
    const command = this.get(name);
    const language = message.author.profile?.data.language || 'en-us';
    const langserv = message.client.services.LANGUAGE;

    if (!command){
      return Promise.resolve({ executed: false, reason: 'NOT_FOUND' });
    };

    const { accept: granted, embed } = await command.testPermissions(message);

    if (!granted){
      message.channel.send(embed).catch(console.error);
      return Promise.resolve({ executed: false, reason: 'NOT_FOUND' });
    };

    const cooldown = message.author.cooldown.get(command.name);

    if (command.cooldown.time && cooldown + command.cooldown.time > Date.now()){
      const path = ['system', 'cooldown'];
      const parameters = {
        "%AUTHOR%": message.author.tag,
        "%TIME%": moment.duration(cooldown + command.cooldown.time - Date.now()).format('m [minute(s), and] s [second(s)]')
      };
      const response = langserv.get({ parameters, path, language })
      await message.reply(response);
      return Promise.resolve({ executed: false, reason: 'COOLDOWN'});
    };

    if (command.cooldown.time){
      message.author.cooldown.set(command.name, Date.now())
    };

    const service = langserv.getCommand(command.name, language);
    command.run(message, service, args);

    return Promise.resolve({ executed: true })
  };

  /**
   * Load command files to this client instance.
   * @param {LoadCommandSettings} settings The settings for loading the commands
   * @note Ignores command files and folders which starts at character '_'
   * @returns {MaiClient}
   */
  load(){
    const commandpath = join(__dirname, '..', 'commands');
    const commanddir = readdirSync(commandpath);
    for (const dir of commanddir.filter(x => !x.startsWith('_'))){
      const commandsubdir = readdirSync(join(commandpath, dir));
      for (const subdir of commandsubdir.filter(x => !x.startsWith('_'))){
        const file = require(join(commandpath, dir, subdir));
        this.add(file, join(commandpath, dir, subdir));
      };
    };
    return this.client;
  };

  /**
  * Reloads a command to the handler
  * @param {query<CommandName|CommandAlias>} query Query of the command to reload
  * @returns {reloadStatus} status of the command to load
  */
  reload(query){
    const command = this.get(query);
    if (!command) return { status: 'FAILED', err: { stack: 'Not Found.' }};

    try {
      delete require.cache[require.resolve(command.path)];
    } catch (err) {
      return { status: 'FAILED', err };
    };

    const newCommand = require(command.path);
    this.add(newCommand, command.path);

    return { status: 'OK', info: new Command(this.client, newCommand, command.path) };
  };

  /**
   * The groups this manager currently holds
   * @type {array}
   * @readonly
   */
  get groups(){
    return [...new Set(this.store.map(x => x.group))];
  };

  /**
   * The number of commands this manager currently holds
   * @type {number}
   * @readonly
   */
  get size(){
    return this.store.size
  };
};
