(function($,document,window,$document,$window){

    window.app = {

        /*
        Variables
         */

        // debug mode
        debug: true,

        // application specific options
        options: {
            host: 'talk.google.com',
            port: 5223,
            username: null,
            remember: false,
            autologin: false,
            showOfflineContacts: false,
            anchorToScreen: 'bottomRight',
            anchorCorner: null,
            bounds: null,
            _saslHash: null
        },


        // Cache frequently used controls
        controls: {
            login: $("#login"),
            username: $("#username"),
            usernameHelp: $("#usernameHelp"),
            usernameGroup: $("#usernameGroup"),
            passwordHelp: $("#passwordHelp"),
            passwordGroup: $("#passwordGroup"),
            password: $("#password"),
            remember: $("#remember"),
            autologin: $("#autologin"),
            accountbar: $("#accountbar"),
            name: $('#user-name'),
            pic: $('#user-pic'),
            status: $('#user-status'),
            toolbar: $("#toolbar-wrapper"),
            content: $("#content"),
            debug: $("#debug"),
            loader: $("#loader"),
            roster: $("#roster"),
            show: $("#show"),
            showLabel: $("#show").find('#show-btn').children('.btn-label'),
            addContact: $('#addContact'),
            settings: $('#settings'),
            searchRoster: $('#searchRoster')
        },

        notification: null,
        stream: null,
        socket: null,
        roster: {},
        show: null, // user's current show
        status: '', // user's current status
        name: null, // user's current name
        // system options

        photo: null, // user's current photo
        windows: {
            conversations: {}
        },

        /* Private variables */

            _db: null,
        _resizeBuffer: null,

        /*
         Public Functions
         */

        /**
         * Connects to the server with the specified username/password combo.
         */
        connect: function(){
            // Hide login form
            app.controls.login.addClass('hide');

            // Show loading indicator
            app.controls.loader.removeClass('hide');

            app.socket = new air.SecureSocket();
            app.stream = new XMPP({
                socket: app.socket,
                saslHash: app.options._saslHash,
                host: app.options.host,
                port: app.options.port,
                events: {
                    'connected': function(){
                        app.controls.loader.addClass('hide');
                    },
                    'disconnected': app._resetApp,
                    'error':function(err){
                        app._error(err, 'resetapp');
                    },
                    'send': function(data){
                        if(app.debug){
                            data = util.htmlentities(data);
                            var output = $('#output', app.windows.debug.document)
                            output.append('<span class="ours">'+ data +'</span>');
                            output.scrollTop(output[0].scrollHeight + 20);
                        }
                    },
                    'receive': function(data){
                        if(app.debug){
                            data = util.htmlentities(data);
                            var output = $('#output', app.windows.debug.document)
                            output.append('<span class="theirs">'+ data +'</span>');
                            output.scrollTop(output[0].scrollHeight + 20);
                        }
                    },
                    'roster': app._roster,
                    'presence': app._presence,
                    'command': app._command,
                    'message': app._message
                }
            });
            app.stream.connect();
        },

        /**
         * Retrieve a contact's vCard information via local cache or server.
         * todo: make public function
         * @private
         */
        getContactInfo: function(jid,callback){
            var cache = app._getCache(jid);

            if(!cache){
                // Request vCard from server
                app.getVCard(jid,callback);
            }else{
                // vCard is cached
                // Execute callback
                callback.call(this,cache);
            }
        },

        /**
         * Retrieve vCard for contact from server.
         * todo: make public function
         * @param jid
         * @param callback
         * @private
         */
        getVCard: function(jid,callback){
            // Request vCard from server
            var id = app.stream._lastID++, vCard;
            app.stream.send('<iq from="'+app.stream.fullJID+'" to="'+jid+'" type="get" id="'+id+'">'+
                '<vCard xmlns="vcard-temp"/>'+
                '</iq>',
                id,
                function(stanza){
                    // Parsed vCard from server
                    vCard = app._parseVCard(stanza);

                    /*
                    If there is an error parsing the vCard, we still have to run the callback
                    function but return null vCard data.
                     */
                    if(vCard !== null){
                        // Save to cache
                        app._setContactCache(jid,vCard);
                    }else{
                        vCard = {
                            fullname: null,
                            photo: null,
                            photohash: null
                        };
                    }

                    // Execute callback
                    callback.call(this,vCard);
                });
        },

        getConversation: function(contact){
            var chatWindow = app.windows.conversations[contact];

            if(typeof(chatWindow) !== 'undefined'){
                if(typeof(chatWindow.message) !== 'undefined'){
                    return chatWindow;
                }else{
                    return false
                }
            }else{
                return false;
            }
        },


        /*
        Private Functions
         */

        /**
         * Receive a message from XMPP stream.
         * @param message
         * @private
         */
        _message: function(message){
            var contact = message.jid,
                body = message.body;

            // Show message if a body is present
            if(body.length > 0){
                app._showMessage(contact,body);
            }

            // Update the chatWindow's chat state
            app._updateChatState(message);
        },

        /**
         * Shows a message in the proper contact window. Plays the notification sound.
         * @param contact
         * @param message
         * @private
         */
        _showMessage: function(contact,message){
            var newWindow = false;

            // Open message window if it does not exist
            var chatWindow = app.getConversation(contact);
            if(!chatWindow){
                app.windows.conversations[contact] = window.open('message.html',contact,'height=500, width=400');
                chatWindow = app.windows.conversations[contact];
                $(chatWindow).on('load', function(){
                    chatWindow.nativeWindow.activate();
                    chatWindow.blur();
                    chatWindow.nativeWindow.orderToFront();
                    chatWindow.message._receiveMessage(contact,message);
                });
                newWindow = true;
            }else{
                chatWindow.message._receiveMessage(contact,message);
            }

            // Play notification sound if the target chat window does not have focus
            if(newWindow || chatWindow.nativeWindow.active === false){
                app.roster[contact].unread++;
                app.notification.play();
                chatWindow.nativeWindow.notifyUser(air.NotificationType.INFORMATIONAL);
            }
        },

        /**
         * Updates the chat state of the appropriate message window.
         * @param message
         * @private
         */
        _updateChatState: function(message){
            var chatWindow = app.getConversation(message.jid);
            if(chatWindow)
                chatWindow.message._updateChatState(message.chatStates);
        },

        /**
         * Kick it all off here
         * @private
         */
        _init: function(){
            // Retrieve stored options
            var options = air.EncryptedLocalStore.getItem('options');
            if(options != null){
                options = JSON.parse(options);
                // Use default if option is not saved
                $.each(app.options, function(optn, value){
                    if(typeof options[optn] === 'undefined'){
                        options[optn] = value;
                    }
                });
                app.options = options;
            }

            if(app.options.bounds !== null){
                // Restore last window position
                window.nativeWindow.bounds = new air.Rectangle(app.options.bounds.x, app.options.bounds.y, app.options.bounds.width, app.options.bounds.height);
            }

            // Spawn debug mode window
            if(app.debug){
                var appWidth = window.nativeWindow.width,
                    appTop = window.nativeWindow.y,
                    appLeft = window.nativeWindow.x,
                    modalLeft = appLeft + appWidth;
                app.windows.debug = window.open('debug.html','Debug','height=800, width=650, top='+appTop+', left='+modalLeft);
                window.nativeWindow.activate();
            }

            // Prepare SQLite database
            app._loadDatabase();

            // Preload audio notification
            var req = new air.URLRequest('notification.mp3');
            app.notification = new air.Sound(req);

            // Fill out login form
            if(app.options.remember){
                app.controls.username.val(app.options.username);
                if(app.options._saslHash !== null)
                    app.controls.password.attr('placeholder','(remembered)').addClass('remembered');
                app.controls.remember.prop('checked', (app.options.remember ? true : false));
                app.controls.autologin.prop('checked', (app.options.autologin ? true : false));
            }

            // GUI event listeners
            app.controls.login.on('submit', app._login);
            app.controls.username.on('keypress', function(){
                app.options._saslHash = null;
                app.controls.password.val('');
                app.controls.password.removeAttr('placeholder').removeClass('remembered');
            });
            app.controls.password.on('keypress', function(){
                app.options._saslHash = null;
                app.controls.password.removeAttr('placeholder').removeClass('remembered');
            });
            app.controls.remember.on('change', function(){
                var checked = $(this).prop('checked');
                if(!checked){
                    app.controls.username.val('');
                    app.controls.password.val('').removeAttr('placeholder').removeClass('placeholder');

                    app.options._saslHash = null;
                    app.options.username = null;
                    app.options.remember = null;
                    app.options.autologin = null;

                    app._saveOptions();
                }
            });
            app.controls.show.on('click', 'li', app._changeShow);
            app.controls.status.on('click', app._editStatus);
            app.controls.addContact.on('click', app._showAddContactModal);
            app.controls.roster.on('contextmenu', '.contact', app._contactContextMenu);
            app.controls.roster.on('click', '.contact', app._openMessage);
            app.controls.settings.on('click', app._openSettings);

            // Show window
            window.nativeWindow.visible = true;

            // Automatically login or present login form?
            if(app.options.autologin){
                app.controls.login.submit();
            }else{
                app.controls.login.removeClass('hide');
            }
        },

        /**
         * Connects to server with credentials from login form
         * @param e
         * @private
         */
        _login: function(e){
            e.preventDefault();

            var username = app.controls.username.val().toLowerCase(),
                password = app.controls.password.val(),
                remember = app.controls.remember.prop('checked'),
                autologin = app.controls.autologin.prop('checked');

            // Validate username
            if(!username.match(/[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/ig)){
                app.controls.usernameGroup.addClass('error');
                app.controls.usernameHelp.html('Please enter a valid email address.');
                return false;
            }

            // Validate password
            if(password.length == 0 && !app.controls.password.hasClass('remembered')){
                app.controls.passwordGroup.addClass('error');
                app.controls.passwordHelp.html('Please enter your password.');
                return false;
            }

            // Destroy local cache if different user is logging in than remembered
            if(username !== app.options.username){
                app.options._saslHash = null;
                app._emptyDatabase();
                air.EncryptedLocalStore.removeItem('status');
            }

            app.options.username = username;
            app.options.remember = remember;
            app.options.autologin = autologin;
            if(app.options._saslHash === null){
                app.options._saslHash = Base64.encode('\u0000' + username + '\u0000' + password);

                if(app.options.remember)
                    app.controls.password.attr('placeholder','(remembered)').addClass('remembered');
            }

            // Save login information if box is checked
            if(app.options.remember){
                var options = JSON.stringify(app.options);

                // Write username
                var bytes = new air.ByteArray();
                bytes.writeUTFBytes(options);
                air.EncryptedLocalStore.setItem('options', bytes);
            }

            // Open connection
            app.connect();
        },

        /**
         * Closes connection to server and resets the application UI.
         * @private
         */
        _logout: function(){
            // Disconnect stream
            app.stream.disconnect();

            // Reset application
            app._resetApp();
        },

        /**
         * Changes the user's "show" value.
         * Acceptable values are online, dnd, away, unavailable.
         * @private
         */
        _changeShow: function(){
            var $this = $(this),
                show = $this.attr('data-show');

            if(show === 'logout'){
                app._logout();
            }else{
                app.show = show;
                app.stream.presence(app.show,app.status);

                // Update GUI control
                app.controls.showLabel.html('<span class="show show-'+app.show+'"></span>');
            }
        },

        /**
         * Enables the user to edit the content of the status div.
         * @param e
         * @private
         */
        _editStatus: function(e){
            e.preventDefault();

            var $status = app.controls.status;

            if($status.text() == '<set a status message>'){
                $status.html('');
            }

            $status.attr('contentEditable', 'true')
                .focus()
                .select()
                .on('keydown', function(e){
                    if(e.keyCode == 13){
                        e.preventDefault();
                        app._changeStatus();
                    }
                })
                .one('blur', function(){
                    app._changeStatus();
                });
        },

        /**
         * Changes the user's status.
         * @private
         */
        _changeStatus: function(){
            var $status = app.controls.status,
                status = util.htmlentities($status.text());

            $status.attr('contentEditable', false).blur().off('keydown');

            app.status = status;
            app.stream.presence(app.show,app.status);

            if(status == ''){
                app.controls.status.html('&lt;set a status message&gt;');
            }

            // Save status locally
            var bytes = new air.ByteArray();
            bytes.writeUTFBytes(status);
            air.EncryptedLocalStore.setItem('status', bytes);
        },

        /**
         * Receive presence stanza from server.
         * @param stanza
         * @private
         */
        _presence: function(stanza){
            switch(stanza.presenceType){
                case 'probe':
                    break;

                // Subscription request
                case 'subscribe':
                    app._askToAddContact(stanza);
                    break;

                // ???
                case 'unsubscribe':
                    break;

                // contact update (show, pic, status)
                case 'unavailable':
                case null:
                default:
                    app._updateContact(stanza);
            }
        },

        /**
         * Opens a modal window that allows the user to add a contact.
         * @private
         */
        _showAddContactModal: function(){
            var modalHeight = 190,
                modalWidth = 420,
                screenHeight = air.Capabilities.screenResolutionY,
                screenWidth = air.Capabilities.screenResolutionX,
                modalTop = (screenHeight / 2) - (modalHeight / 2),
                modalLeft = (screenWidth / 2) - (modalWidth / 2);

            var addModal = app.windows.askModal = window.open('modals/addContact.html','closeModal','height='+modalHeight+', width='+modalWidth+', top = '+modalTop+', left = '+modalLeft),
                $addModal = $(addModal);

            $addModal.on('load', function(){
                // Add contact
                var $addDocument = addModal.document,
                    $addContact = $('#addContact', $addDocument),
                    $emailHelp = $("#emailHelp", $addDocument),
                    $email = $('#email', $addDocument);

                $addContact.on('submit', function(e){
                    e.preventDefault();

                    // Validate email
                    var email = $email.val();
                    if(!email.match(/[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/ig)){
                        $emailHelp.html('Please enter a valid email address.');
                        return false;
                    }

                    // Send presence request
                    var id = app.stream._lastID++;
                    app.stream.send('<presence id="'+id+'" to="'+email+'" type="subscribe" />', id, function(stanza){
                        console.log(stanza);
                    });

                    addModal.close();
                });
            });
        },

        /**
         * Creates a right click context menu for contacts.
         * @param e
         * @private
         */
        _contactContextMenu: function(e){
            e.preventDefault();
            var $this = $(this),
                menu = new air.NativeMenu(),
                jid = $this.attr('data-jid'),
                contact = app.roster[jid];

            // Rename
            var rename = menu.addItem(new air.NativeMenuItem("Rename"));
            rename.addEventListener(air.Event.SELECT, function(){
                var $name = $this.find('.rename-contact');
                $name.attr('contentEditable', 'true')
                    .focus()
                    .select()
                    .on('keydown', function(e){
                        // Trigger when enter is pressed
                        if(e.keyCode !== 13) return true;

                        // Disable editing
                        $(this).attr('contentEditable', false).blur();

                        // Rename contact
                        var name = $(this).text();
                        app._renameContact(jid, name);
                    });
            });

            // Block
            var block = menu.addItem(new air.NativeMenuItem("Block"));

            // Remove
            var remove = menu.addItem(new air.NativeMenuItem("Remove"));
            remove.addEventListener(air.Event.SELECT, function(){
                app._removeContact(jid);
            });

            // Show menu
            menu.display(window.nativeWindow.stage, e.clientX, e.clientY);
        },

        /**
         * Removes a contact from the roster.
         * @param jid
         * @private
         */
        _removeContact: function(jid){
            // Remove contact from roster
            delete app.roster[jid];
            app._drawRoster();

            var id = app.stream._lastID++;
            app.stream.send("<iq from='"+app.stream.fullJID+"' id='"+id+"' type='set'>"+
                "<query xmlns='jabber:iq:roster'>"+
                "<item jid='"+jid+"' subscription='remove'/>"+
                "</query>"+
                "</iq>");
        },

        /**
         * Renames a contact.
         * @param jid
         * @param name
         * @private
         */
        _renameContact: function(jid, name){
            var id = app.stream._lastID++;
            app.stream.send("<iq from='"+app.stream.fullJID+"' id='"+id+"' type='set'>"+
                                "<query xmlns='jabber:iq:roster'>"+
                                    "<item jid='"+jid+"' name='"+name+"'/>"+
                                "</query>"+
                            "</iq>");
        },

        /**
         * Opens a chat window with a contact.
         * @param e
         * @private
         */
        _openMessage: function(e){
            e.preventDefault();
            var $this = $(this),
                jid = $this.attr('data-jid');

            var chatWindow = app.getConversation(jid);
            if(!chatWindow){
                chatWindow = app.windows.conversations[jid] = window.open('message.html',jid,'height=500, width=400');
            }
            chatWindow.nativeWindow.activate();

            $(chatWindow).on('load', function(){
                chatWindow.message.controls.compose.focus();
            });
        },


        /**
         * Prompts the user to approve or deny a subscription request.
         * @param stanza
         * @private
         */
        _askToAddContact: function(stanza){
            // Retrieve the vCard of the requesting user
            app.getVCard(stanza.from, function(vCard){
                var modalHeight = 200,
                    modalWidth = 420,
                    screenHeight = air.Capabilities.screenResolutionY,
                    screenWidth = air.Capabilities.screenResolutionX,
                    modalTop = (screenHeight / 2) - (modalHeight / 2),
                    modalLeft = (screenWidth / 2) - (modalWidth / 2);

                var askModal = app.windows.askModal = window.open('modals/askToAddContact.html','closeModal','height='+modalHeight+', width='+modalWidth+', top = '+modalTop+', left = '+modalLeft),
                    $askModal = $(askModal);

                $askModal.on('load', function(){
                    // Cache elements
                    var askDocument = askModal.document,
                        $addFriend = $('#addFriend', askDocument),
                        $ignore = $('#ignore', askDocument),
                        $block = $('#block', askDocument),
                        $contactPhoto = $('#contactPhoto', askDocument),
                        $contactName = $('#contactName', askDocument),
                        friendlyName;

                    // Populate modal with vCard information

                    // Calculate friendly name
                    if(vCard.fullname !== null){
                        friendlyName = vCard.fullname;
                    }
                    else{
                        friendlyName = stanza.from;
                    }
                    $contactName.html(friendlyName);

                    // Photo
                    if(vCard.photo !== null)
                        $contactPhoto.html('<img src="data:image;base64,'+vCard.photo+'" alt="'+friendlyName+'">');


                    // Bind event listeners
                    $addFriend.on('click', function(e){
                        e.preventDefault();

                        // Approve subscription request
                        var id = app.stream._lastID++;
                        app.stream.send('<presence from="'+app.stream.fullJID+'" to="'+stanza.from+'" type="subscribed" id="'+id+'" />');

                        // Close window
                        askModal.close();
                    });
                    $block.on('click', function(e){
                        e.preventDefault();

                        // todo: blocking with extended contact attributes: https://developers.google.com/talk/jep_extensions/roster_attributes
                    });
                    $ignore.on('click', function(e){
                        e.preventDefault();

                        // Deny subscription request
                        var id = app.stream._lastID++;
                        app.stream.send('<presence from="'+app.stream.fullJID+'" to="'+stanza.from+'" type="unsubscribed" id="'+id+'" />');

                        // Close window
                        askModal.close();
                    });

                    askModal.nativeWindow.activate();
                    askModal.nativeWindow.orderToFront();
                    askModal.nativeWindow.alwaysInFront = true;
                    askModal.nativeWindow.alwaysInFront = false;
                });
            });
        },

        /**
         * Timeout used to prevent spamming the server for vCard data when a contact
         * changes their photo and multiple presence updates are received from all
         * their resources at once.
         */
        _vCardUpdateBuffer: null,
        /**
         * Updates a contact with new presence information.
         * @param stanza
         * @private
         */
        _updateContact: function(stanza){
            var fullJID = stanza.xml.attr('from'),
                split = fullJID.split('/'),
                baseJID = split[0].toLowerCase(),
                resource = split[1],
                show = stanza.xml.children('show').text(),
                status = stanza.xml.children('status').text(),
                contact = app.roster[baseJID];

            // Contact must exist in roster
            if(typeof contact == 'undefined') return;

            // sanitize show
            if(show == ''){
                if(stanza.presenceType == 'unavailable'){
                    show = 'unavailable'
                }else{
                    show = 'online';
                }
            }

            // calculate numeric code for show (used in sorting)
            var showCode;
            switch(show){
                case 'unavailable':
                    showCode = 0;
                    break;
                case 'away':
                    showCode = 1;
                    break;
                case 'dnd':
                    showCode = 2;
                    break;
                case 'online':
                default:
                    showCode = 3;
            }

            contact.resources[resource] = {show: show, showCode: showCode, status: status };

            // Get best status for contact
            app._getBestStatus(baseJID);

            // redraw roster
            app._drawRoster();

            // Update message window
            var chatWindow = app.getConversation(baseJID);
            if(chatWindow){
                // Only show if we're changing to reflect their best status (same as roster)
                if(show == contact.show)
                    chatWindow.message._updateShow(show);

                if(status == contact.status)
                    chatWindow.message._updateStatus(status);
            }

            // Check photohash to see if we need to update the contact's photo
            var photohash = stanza.xml.children('x').children('photo').text();
            if(photohash.length > 0 && photohash !== contact.vCard.photohash){
                // Buffer the vCard update
                clearTimeout(app._vCardUpdateBuffer);
                app._vCardUpdateBuffer = setTimeout(function(){
                    if(app.debug) console.log('Updating photo for '+contact.jid+' (previous hash: '+contact.vCard.photohash+') (new hash: '+photohash+')');

                    // Request vCard from server
                    app.getVCard(contact.jid,function(vCard){
                        // Save to roster
                        contact.vCard = vCard;
                        // Redraw roster
                        app._drawRoster();
                        // Redraw photo in message window
                        var chatWindow = app.getConversation(contact.jid);
                        if(chatWindow) chatWindow._updatePhoto(vCard.photo);
                    });
                }, 250);
            }
        },

        _command: function(stanza){
            // Determine query
            var query = stanza.xml.children('query'),
                type = stanza.xml.attr('type'),
                from = stanza.xml.attr('from');

            switch(type){
                case 'set':
                    // Roster push qualifiers (http://xmpp.org/rfcs/rfc6121.html 2.1.6 Roster Push)
                    if(query.attr('xmlns') == 'jabber:iq:roster'
                        && ( typeof(from) == 'undefined' || from == app.options.username)){
                        app._rosterPush(stanza);
                    }
                    break;
            }
        },

        /**
         * Receives roster push from server. Adds contact to roster and redraws.
         * @param stanza
         * @private
         */
        _rosterPush: function(stanza){
            var id = stanza.xml.attr('id'),
                query = stanza.xml.children('query'),
                items = query.children();

            $.each(items, function(i, item){
                var $item = $(item),
                    jid = $item.attr('jid'),
                    subscription = $item.attr('subscription'),
                    name = $item.attr('name'),
                    contact = app.roster[jid],
                    subType;

                switch(subscription){
                    // Remove contact from roster
                    case 'remove':
                        // Remove contact if exists
                        if(typeof(contact) !== 'undefined'){
                            delete app.roster[contact.jid];

                            // Redraw roster
                            app._drawRoster();
                        }
                        break;

                    // Contact has a subscription to the user's presence, not shown in roster
                    case 'from':
                        break;

                    // User has a subscription (or is pending) to the contact's presence, shown in roster
                    case 'none':
                        subType = 'pending';
                        // Cancel if no subscription is pending
                        if($item.attr('ask') !== 'subscribe') return false;
                    case 'to':
                    case 'both':
                        // Does the user exist in the roster already?
                        if(typeof(contact) == 'undefined'){
                            // Add to roster
                            app._addContactToRoster({ jid: jid, name: name, subscription: subscription }, function(){
                                // Send result back to server
                                app.stream.send('<iq type="result" id="'+id+'" from="'+app.stream.fullJID+'" />');
                            });
                        }else{
                            // Update user in roster
                            contact.name = name;
                            contact.subscription = subscription;

                            // Re-generate friendly name for contact
                            app._getFriendlyName(contact);

                            app._drawRoster();
                        }
                        break;
                }
            });
        },

        /**
         * Adds a contact to the roster.
         * @private
         */
        _addContactToRoster: function(contact, callback){
            // Initial object defaults
            contact = app.roster[contact.jid] = {
                name: contact.name,
                jid: contact.jid,
                subscription: contact.subscription,
                vCard: {
                    fullname: null,
                    photo: null,
                    photohash: null
                },
                show: 'unavailable',
                showCode: 0,
                resources: {},
                unread: 0
            };

            // Retrieve vCard for contact
            app.getContactInfo(contact.jid, function(vCard){
                contact.vCard = vCard;

                // Track vCard load status
                contact.loaded = true;

                // Generate a friendly name for this contact
                app._getFriendlyName(contact);

                if($.isFunction(callback)){
                    callback.call(this,contact);
                }
            });
        },

        /**
         * Determines the appropriate name to display to the user for the contact.
         * @param contact
         * @return {*}
         * @private
         */
        _getFriendlyName: function(contact){
            // Determine friendly name for contact
            var name;
            if(typeof(contact.name) !== 'undefined'){
                name = contact.name;
            }
            else if(contact.vCard.fullname !== null){
                name = contact.vCard.fullname;
            }
            else{
                name = contact.jid;
            }

            contact.friendlyName = name;
            return name;
        },

        /**
         * Receives the user's roster from the XMPP stream once it completes negotiation.
         * Renders the account bar UI and assembles vCard information for the user and
         * all contacts.
         * @private
         */
        _roster: function(contacts){
            // Render account bar
            app._getUserInfo();

            // Assemble object for each contact
            $.each(contacts, function(i,contact){
                app._addContactToRoster(contact, function(){
                    // Check if all contacts are loaded
                    if(contacts.length !== Object.keys(app.roster).length) return false;

                    var ready = true;
                    $.each(app.roster, function(i, contact){
                        if(contact.loaded !== true) ready = false;
                    });

                    if(ready){
                        app._drawRoster();

                        // Application is connected, loaded and ready
                        app._ready();
                    }
                });
            });
        },

        _drawRoster: function(){
            var roster = app.controls.roster,
                sortArray = app._sortRoster();

            roster.html('');
            $.each(sortArray, function(){
                var contact = app.roster[this[0]];

                // photo
                var photo = '';
                if(contact.vCard.photo !== null){
                    photo = '<img src="data:image;base64,'+contact.vCard.photo+'">';
                }

                // status
                var status = '';
                if(typeof(contact.status) !== 'undefined'){
                    status = contact.status;
                }

                // Hide offline contacts?
                if(!app.options.showOfflineContacts && contact.show == 'unavailable')
                    return true;

                var li = $('<li class="contact '+contact.show+'" data-jid="'+contact.jid+'">' +
                    '<span class="name"><span class="rename-contact">'+contact.friendlyName+'</span>&nbsp;<small class="status">'+status+'</small></span>' +
                    '<span class="show show-'+contact.show+'"></span>' +
                    '<span class="pic">'+photo+'</span>' +
                    '</li>');

                roster.append(li);
                contact.control = li;
            });
        },


        _ready: function(){
            // Set to online
            app.show = 'online';
            app.stream.presence(app.show,app.status);

            // Hide loader
            app.controls.loader.animate({
                opacity: 0
            }, 250, function(){
                app.controls.loader.addClass('hide').css('opacity', 1);
                app.controls.content.removeClass('vertcenter');
                app.controls.roster.removeClass('hide');
                app.controls.accountbar.removeClass('hide');
                app.controls.toolbar.removeClass('hide');
            })
        },

        /*
         This mechanism shows the most available status for each contact.
         Due to the fact that some clients implement priority statically (IMO for Android is 1,
         Google Talk for Windows and Google Talk for Android are 24) it is impossible to
         determine the most available resource (and thus presence).

         With this mechanism, the most available presence is shown using the contact's "show"
         value (online, dnd, away, unavailable). In the event that two or more resources are
         tied in status, the highest priority will be taken.
         todo: priority as secondary sort

         http://code.google.com/p/android/issues/detail?id=2140
         http://blog.jdconley.com/2007/05/xmpp-presence-priority.html
         */
        _getBestStatus: function(jid){
            var contact = app.roster[jid],
                show = 'unavailable', showCode = 0, status = '', priority = 0;
            $.each(contact.resources, function(){
                if(showCode < this.showCode){
                    show = this.show;
                    showCode = this.showCode;
                    status = this.status;
                }
            });
            contact.show = show;
            contact.showCode = showCode;
            contact.status = status;
        },

        /**
         * Sorts the contact roster by availability, then lexically
         * @return {Array}
         * @private
         */
        _sortRoster: function(){
            var array = new Array();
            $.each(app.roster, function(jid, contact){
                array.push([jid,contact.showCode]);
            });

            array.sort(function(a, b){
                var aJID = a[0],
                    bJID = b[0];
                if(a[1] === b[1]){
                    // Sort by name
                    if(app.roster[a[0]].friendlyName < app.roster[b[0]].friendlyName){
                        return -1;
                    }else{
                        return 1;
                    }
                }else if(a[1] > b[1]){
                    return -1;
                }else{
                    return 1;
                }
            });

            return array;
        },

        /**
         * Retrieves the current user's vCard information via cache or server.
         * @private
         */
        _getUserInfo: function(){
            app.getContactInfo(app.options.username, function(vCard){
                // name
                if(vCard.fullname !== null){
                    app.name = vCard.fullname;
                }else{
                    app.name = app.options.username;
                }
                app.controls.name.text(app.name);

                // pic
                if(vCard.photo !== null){
                    app.photo = vCard.photo;
                    app.controls.pic.html('<img src="data:image;base64,'+vCard.photo+'">');
                }

                // status
                var status = air.EncryptedLocalStore.getItem('status');
                if(status !== null){
                    app.status = status;
                    app.controls.status.text(status);
                }else{
                    app.controls.status.html('&lt;set a status message&gt;');
                }
            });
        },


        /**
         * Parses XML stanza for vCard data.
         * @param stanza
         * @return vCard - object containing vCard data
         * @private
         */
        _parseVCard: function(stanza){
            // Parse vCard
            var xml = stanza.xml.children('vCard'),
                error = stanza.xml.children('error');

            // No vCard present
            if(xml.length == 0 || error.length > 0){
                return null;
            }

            var fullname = xml.children('FN'),
                photo = xml.children('PHOTO').children('binval'),
                vCard = {
                    fullname: null,
                    photo: null,
                    photohash: null
                };

            if(fullname.length > 0){
                vCard.fullname = fullname.text();
            }

            if(photo.length > 0){
                vCard.photo = photo.text();
                // calculate photohash using the CryptoJS library (aww yeaaah)
                vCard.photohash = CryptoJS.SHA1(CryptoJS.enc.Base64.parse(vCard.photo)).toString();
            }

            return vCard;
        },


        /**
         * Retrieves cached vCard data for specified contact.
         * @private
         */
        _getCache: function(jid){
            // Retrieve cached vCard for this contact
            var stmt = new air.SQLStatement(),
                result;
            stmt.sqlConnection = app._db;

            // Prevent injection http://www.simonwhatley.co.uk/preventing-sql-injection-in-an-air-application
            stmt.text = 'SELECT fullname,photo,photohash FROM roster WHERE jid = @jid';
            stmt.parameters["@jid"] = jid;

            try{
                stmt.execute();
            }catch(error){
                if(app.debug){
                    app._error('SQLite error: '+error, 'notify');
                    air.trace(error.message);
                    return false;
                }
            }

            result = stmt.getResult();
            if(result.data !== null){
                result = result.data[0];
            }else{
                result = false;
            }

            return result;
        },


        /**
         * Replaces cached vCard information for a given contact.
         * @param jid - the JID of the contact
         * @param vCard - object containing the vCard data to cache
         * @private
         */
        _setContactCache: function(jid,vCard){
            /* Cache vCard data for this contact */

            // Delete old cache
            var stmt = new air.SQLStatement();
            stmt.sqlConnection = app._db;

            stmt.text = 'DELETE FROM roster WHERE jid = @jid';
            stmt.parameters['@jid'] = jid;

            try{
                stmt.execute();
            }catch(error){
                air.trace("SQLite error (410): ", error);
                air.trace(error.message);
            }
            stmt.clearParameters();

            // Create cache
            stmt.text = 'INSERT INTO roster VALUES(@jid,@fullname,@photo,@photohash)';
            stmt.parameters['@jid'] = jid;
            stmt.parameters['@fullname'] = vCard.fullname;
            stmt.parameters['@photo'] = vCard.photo;
            stmt.parameters['@photohash'] = vCard.photohash;

            try{
                stmt.execute();
            }catch(error){
                if(air.debug){
                    app._error(error.message, 'notify');
                }
            }
        },



        /**
         * Saves general options to local store.
         * @private
         */
        _saveOptions: function(){
            // Convert JSON to string
            var options = JSON.stringify(app.options);

            // Convert string to bytes
            var bytes = new air.ByteArray();
            bytes.writeUTFBytes(options);
            air.EncryptedLocalStore.setItem('options', bytes);
        },

        /**
         * Establishes a connection to the SQLite database. If the database does not
         * exist, it will create one using the DB template.
         * @private
         */
        _loadDatabase: function(){
            var filename = air.File.applicationStorageDirectory.resolvePath('bettertalk.db');
            if(!filename.exists){
                var template = air.File.applicationDirectory.resolvePath('bettertalk.db');
                template.copyTo(filename, true);
            }

            try{
                app._db = new air.SQLConnection();
                app._db.open(filename);
            }catch(error){
                if(app.debug) air.trace(error.message);
                app._error('Unable to load database, please restart the application and try again.', 'fatal');
            }
        },

        /**
         * Deletes all records from the roster table of the SQLite database. Used when switching
         * accounts.
         * @private
         */
        _emptyDatabase: function(){
            var stmt = new air.SQLStatement();
            stmt.sqlConnection = app._db;
            stmt.text = 'DELETE FROM roster;'

            try {
                stmt.execute();
            } catch (error) {
                if(app.debug) air.trace(error.message);
                app._error('Unable to prepare database, please restart the application and try again.', 'fatal');
            }
        },

        /* do not run! */
        _createDatabase: function(){
            var db = new air.SQLConnection(),
                filename = air.File.applicationDirectory.resolvePath('bettertalk.db');

            db.open(filename);

            var stmt = new air.SQLStatement();
            stmt.sqlConnection = db;

            var sql = 'CREATE TABLE IF NOT EXISTS roster ('+
                '   jid         TEXT PRIMARY KEY,'+
                '   fullname    TEXT,' +
                '   photo       BLOB,' +
                '   photohash   TEXT'+
                ');';
            stmt.text = sql;

            try {
                stmt.execute();
            } catch (error) {
                air.trace("Error inserting new record into database: ", error);
                air.trace(error.message);
            }
        },

        /**
         * Resets the application's UI and variables. Used when throwing an
         * error or switching users.
         * @private
         */
        _resetApp: function(){
            // Reset variables
            app.stream = null;
            app.socket = null;
            app.roster = {};
            app.show = null;
            app.status = '';

            // Close all conversations
            $.each(app.windows.conversations, function(){
                this.close();
            });
            app.windows.conversations = {};

            // Reset UI
            app.controls.roster.html('').addClass('hide');
            app.controls.accountbar.addClass('hide');
            app.controls.name.html('');
            app.controls.status.html('');
            app.controls.toolbar.addClass('hide');
            app.controls.content.addClass('vertcenter');
            app.controls.loader.addClass('hide');
            app.controls.showLabel.html('<span class="show show-online"></span>');

            // Reset login form
            if(app.options.remember){
                app.controls.username.val(app.options.username);
                if(app.options._saslHash !== null)
                    app.controls.password.val('').attr('placeholder','(remembered)').addClass('remembered');
                app.controls.remember.prop('checked', (app.options.remember ? true : false));
                app.controls.autologin.prop('checked', (app.options.autologin ? true : false));
            }else{
                app.controls.username.val('');
                app.options._saslHash = null;
                app.controls.password.val('').removeAttr('placeholder').removeClass('remembered');
                app.controls.remember.prop('checked', false);
                app.controls.autologin.prop('checked', false);
            }

            app.controls.usernameGroup.removeClass('error');
            app.controls.usernameHelp.html('');
            app.controls.passwordGroup.removeClass('error');
            app.controls.passwordHelp.html('');

            // Show login form
            app.controls.login.removeClass('hide');
        },

        /**
         * Notifies the user of error.
         * Error types:
         *  - notify: notify the user
         *  - resetapp: reset the application
         *  - fatal: close application
         * @private
         */
        _error: function(error, type){
            // Always notify the user
            alert('Error: '+error);

            switch(type){
                case 'resetapp':
                    app._resetApp();
                    break;
                case 'fatal':
                    air.NativeApplication.nativeApplication.exit();
                    break;
            }
        },

        /**
         * Prompts the user to confirm when the application is attempting to close.
         * @param e - CLOSING event object
         * @private
         */
        _warnOnExit: function(e){
            e.preventDefault();

            var modalHeight = 160,
                modalWidth = 400,
                screenHeight = air.Capabilities.screenResolutionY,
                screenWidth = air.Capabilities.screenResolutionX,
                modalTop = (screenHeight / 2) - (modalHeight / 2),
                modalLeft = (screenWidth / 2) - (modalWidth / 2);

            var closeModal = app.windows.closeModal = window.open('modals/warnOnExit.html','closeModal','height='+modalHeight+', width='+modalWidth+', top = '+modalTop+', left = '+modalLeft);
        },

        /**
         * Opens the settings window.
         * @param e
         * @private
         */
        _openSettings: function(e){
            e.preventDefault();

            var modalHeight = 500,
                modalWidth = 600,
                screenHeight = air.Capabilities.screenResolutionY,
                screenWidth = air.Capabilities.screenResolutionX,
                modalTop = (screenHeight / 2) - (modalHeight / 2),
                modalLeft = (screenWidth / 2) - (modalWidth / 2);

            var closeModal = app.windows.closeModal = window.open('modals/settings.html','settings','resizable=no, height='+modalHeight+', width='+modalWidth+', top = '+modalTop+', left = '+modalLeft);
        },

        /**
         * Resize and move event handler, saves the latest window position and size.
         * @param e
         * @private
         */
        _saveBounds: function(e){
            clearInterval(app._resizeBuffer);
            app._resizeBuffer = setTimeout(function(){
                app.options.bounds = {
                    x:      e.afterBounds.x,
                    y:      e.afterBounds.y,
                    width:  e.afterBounds.width,
                    height: e.afterBounds.height
                };
                app._saveOptions();
            }, 150);
        }



    };

    $document.ready(app._init);

    /**
     * Remember window size and position
     */
    window.nativeWindow.addEventListener(air.Event.CLOSING, app._warnOnExit);
    window.nativeWindow.addEventListener(air.NativeWindowBoundsEvent.RESIZE, app._saveBounds);
    window.nativeWindow.addEventListener(air.NativeWindowBoundsEvent.MOVE, app._saveBounds);



    /*
     Utilities
     */

    // Safe console logging
    if(typeof(air) !== 'undefined' && typeof(air.trace) !== 'undefined'){
        window.console = {
            log: air.Introspector.Console.log
        };
    }

    window.util = {
        // http://phpjs.org/functions/htmlentities:425
        htmlentities: function (string, quote_style, charset, double_encode) {
            // http://kevin.vanzonneveld.net
            // +   original by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
            // +    revised by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
            // +   improved by: nobbler
            // +    tweaked by: Jack
            // +   bugfixed by: Onno Marsman
            // +    revised by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
            // +    bugfixed by: Brett Zamir (http://brett-zamir.me)
            // +      input by: Ratheous
            // +   improved by: Rafał Kukawski (http://blog.kukawski.pl)
            // +   improved by: Dj (http://phpjs.org/functions/htmlentities:425#comment_134018)
            // -    depends on: get_html_translation_table
            // *     example 1: htmlentities('Kevin & van Zonneveld');
            // *     returns 1: 'Kevin &amp; van Zonneveld'
            // *     example 2: htmlentities("foo'bar","ENT_QUOTES");
            // *     returns 2: 'foo&#039;bar'
            var hash_map = this.get_html_translation_table('HTML_ENTITIES', quote_style),
                symbol = '';
            string = string == null ? '' : string + '';

            if (!hash_map) {
                return false;
            }

            if (quote_style && quote_style === 'ENT_QUOTES') {
                hash_map["'"] = '&#039;';
            }

            if (!!double_encode || double_encode == null) {
                for (symbol in hash_map) {
                    if (hash_map.hasOwnProperty(symbol)) {
                        string = string.split(symbol).join(hash_map[symbol]);
                    }
                }
            } else {
                string = string.replace(/([\s\S]*?)(&(?:#\d+|#x[\da-f]+|[a-zA-Z][\da-z]*);|$)/g, function (ignore, text, entity) {
                    for (symbol in hash_map) {
                        if (hash_map.hasOwnProperty(symbol)) {
                            text = text.split(symbol).join(hash_map[symbol]);
                        }
                    }

                    return text + entity;
                });
            }

            return string;
        },

        get_html_translation_table:function (table, quote_style) {
            // http://kevin.vanzonneveld.net
            // +   original by: Philip Peterson
            // +    revised by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
            // +   bugfixed by: noname
            // +   bugfixed by: Alex
            // +   bugfixed by: Marco
            // +   bugfixed by: madipta
            // +   improved by: KELAN
            // +   improved by: Brett Zamir (http://brett-zamir.me)
            // +   bugfixed by: Brett Zamir (http://brett-zamir.me)
            // +      input by: Frank Forte
            // +   bugfixed by: T.Wild
            // +      input by: Ratheous
            // %          note: It has been decided that we're not going to add global
            // %          note: dependencies to php.js, meaning the constants are not
            // %          note: real constants, but strings instead. Integers are also supported if someone
            // %          note: chooses to create the constants themselves.
            // *     example 1: get_html_translation_table('HTML_SPECIALCHARS');
            // *     returns 1: {'"': '&quot;', '&': '&amp;', '<': '&lt;', '>': '&gt;'}
            var entities = {},
                hash_map = {},
                decimal;
            var constMappingTable = {},
                constMappingQuoteStyle = {};
            var useTable = {},
                useQuoteStyle = {};

            // Translate arguments
            constMappingTable[0] = 'HTML_SPECIALCHARS';
            constMappingTable[1] = 'HTML_ENTITIES';
            constMappingQuoteStyle[0] = 'ENT_NOQUOTES';
            constMappingQuoteStyle[2] = 'ENT_COMPAT';
            constMappingQuoteStyle[3] = 'ENT_QUOTES';

            useTable = !isNaN(table) ? constMappingTable[table] : table ? table.toUpperCase() : 'HTML_SPECIALCHARS';
            useQuoteStyle = !isNaN(quote_style) ? constMappingQuoteStyle[quote_style] : quote_style ? quote_style.toUpperCase() : 'ENT_COMPAT';

            if (useTable !== 'HTML_SPECIALCHARS' && useTable !== 'HTML_ENTITIES') {
                throw new Error("Table: " + useTable + ' not supported');
                // return false;
            }

            entities['38'] = '&amp;';
            if (useTable === 'HTML_ENTITIES') {
                entities['160'] = '&nbsp;';
                entities['161'] = '&iexcl;';
                entities['162'] = '&cent;';
                entities['163'] = '&pound;';
                entities['164'] = '&curren;';
                entities['165'] = '&yen;';
                entities['166'] = '&brvbar;';
                entities['167'] = '&sect;';
                entities['168'] = '&uml;';
                entities['169'] = '&copy;';
                entities['170'] = '&ordf;';
                entities['171'] = '&laquo;';
                entities['172'] = '&not;';
                entities['173'] = '&shy;';
                entities['174'] = '&reg;';
                entities['175'] = '&macr;';
                entities['176'] = '&deg;';
                entities['177'] = '&plusmn;';
                entities['178'] = '&sup2;';
                entities['179'] = '&sup3;';
                entities['180'] = '&acute;';
                entities['181'] = '&micro;';
                entities['182'] = '&para;';
                entities['183'] = '&middot;';
                entities['184'] = '&cedil;';
                entities['185'] = '&sup1;';
                entities['186'] = '&ordm;';
                entities['187'] = '&raquo;';
                entities['188'] = '&frac14;';
                entities['189'] = '&frac12;';
                entities['190'] = '&frac34;';
                entities['191'] = '&iquest;';
                entities['192'] = '&Agrave;';
                entities['193'] = '&Aacute;';
                entities['194'] = '&Acirc;';
                entities['195'] = '&Atilde;';
                entities['196'] = '&Auml;';
                entities['197'] = '&Aring;';
                entities['198'] = '&AElig;';
                entities['199'] = '&Ccedil;';
                entities['200'] = '&Egrave;';
                entities['201'] = '&Eacute;';
                entities['202'] = '&Ecirc;';
                entities['203'] = '&Euml;';
                entities['204'] = '&Igrave;';
                entities['205'] = '&Iacute;';
                entities['206'] = '&Icirc;';
                entities['207'] = '&Iuml;';
                entities['208'] = '&ETH;';
                entities['209'] = '&Ntilde;';
                entities['210'] = '&Ograve;';
                entities['211'] = '&Oacute;';
                entities['212'] = '&Ocirc;';
                entities['213'] = '&Otilde;';
                entities['214'] = '&Ouml;';
                entities['215'] = '&times;';
                entities['216'] = '&Oslash;';
                entities['217'] = '&Ugrave;';
                entities['218'] = '&Uacute;';
                entities['219'] = '&Ucirc;';
                entities['220'] = '&Uuml;';
                entities['221'] = '&Yacute;';
                entities['222'] = '&THORN;';
                entities['223'] = '&szlig;';
                entities['224'] = '&agrave;';
                entities['225'] = '&aacute;';
                entities['226'] = '&acirc;';
                entities['227'] = '&atilde;';
                entities['228'] = '&auml;';
                entities['229'] = '&aring;';
                entities['230'] = '&aelig;';
                entities['231'] = '&ccedil;';
                entities['232'] = '&egrave;';
                entities['233'] = '&eacute;';
                entities['234'] = '&ecirc;';
                entities['235'] = '&euml;';
                entities['236'] = '&igrave;';
                entities['237'] = '&iacute;';
                entities['238'] = '&icirc;';
                entities['239'] = '&iuml;';
                entities['240'] = '&eth;';
                entities['241'] = '&ntilde;';
                entities['242'] = '&ograve;';
                entities['243'] = '&oacute;';
                entities['244'] = '&ocirc;';
                entities['245'] = '&otilde;';
                entities['246'] = '&ouml;';
                entities['247'] = '&divide;';
                entities['248'] = '&oslash;';
                entities['249'] = '&ugrave;';
                entities['250'] = '&uacute;';
                entities['251'] = '&ucirc;';
                entities['252'] = '&uuml;';
                entities['253'] = '&yacute;';
                entities['254'] = '&thorn;';
                entities['255'] = '&yuml;';
            }

            if (useQuoteStyle !== 'ENT_NOQUOTES') {
                entities['34'] = '&quot;';
            }
            if (useQuoteStyle === 'ENT_QUOTES') {
                entities['39'] = '&#39;';
            }
            entities['60'] = '&lt;';
            entities['62'] = '&gt;';


            // ascii decimals to real symbols
            for (decimal in entities) {
                if (entities.hasOwnProperty(decimal)) {
                    hash_map[String.fromCharCode(decimal)] = entities[decimal];
                }
            }

            return hash_map;
        },

        nl2br:function (str, is_xhtml) {
            // http://kevin.vanzonneveld.net
            // +   original by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
            // +   improved by: Philip Peterson
            // +   improved by: Onno Marsman
            // +   improved by: Atli Þór
            // +   bugfixed by: Onno Marsman
            // +      input by: Brett Zamir (http://brett-zamir.me)
            // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
            // +   improved by: Brett Zamir (http://brett-zamir.me)
            // +   improved by: Maximusya
            // *     example 1: nl2br('Kevin\nvan\nZonneveld');
            // *     returns 1: 'Kevin<br />\nvan<br />\nZonneveld'
            // *     example 2: nl2br("\nOne\nTwo\n\nThree\n", false);
            // *     returns 2: '<br>\nOne<br>\nTwo<br>\n<br>\nThree<br>\n'
            // *     example 3: nl2br("\nOne\nTwo\n\nThree\n", true);
            // *     returns 3: '<br />\nOne<br />\nTwo<br />\n<br />\nThree<br />\n'
            var breakTag = (is_xhtml || typeof is_xhtml === 'undefined') ? '<br ' + '/>' : '<br>'; // Adjust comment to avoid issue on phpjs.org display

            return (str + '').replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1' + breakTag + '$2');
        }
    };


})(jQuery,document,window,$(document),$(window));


