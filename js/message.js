(function($,window,document,$window,$document,app,util){

    window.message = {

        contact: null,
        name: null,
        status: null,
        show: null,
        lastID: 100,
        lastMessage: {
            author: null,
            time: null
        },
        chatStates: {
            composing: false
        },
        controls: {
            body: $('#messageWindow', document),
            name: $("#user-name", document),
            status: $("#user-status", document),
            show: $("#contact-show", document),
            pic: $("#user-pic", document),
            accountbar: $("#accountbar", document),
            content: $("#content", document),
            toolbar: $("#toolbar-wrapper", document),
            messages: $("#messages", document),
            compose: $("#compose", document),
            send: $("#send", document),
            composing: $("#composing", document)
        },
        _isComposing: false,
        _composingTimeout: null,

        /* Public Functions */
        /**
         * Removes the window from the array of open conversations.
         */
        close: function(){
            delete app.windows.conversations[window.name];
        },

        /**
         * Sends a message to the contact.
         */
        sendMessage: function(){
            var msg = message.controls.compose.text();

            // No blank messages
            if(msg == '') return;

            // Reset composition field
            message.controls.compose.html('');

            // HTML entities
            msg = util.htmlentities(msg);

            // Send message
            var id = message.lastID++;
            app.stream.send(
                '<message to="'+message.contact.jid+'" type="chat" id="'+id+'" from="'+app.stream.fullJID+'">' +
                    '<body>'+msg+'</body>' +
                    '<active xmlns="http://jabber.org/protocol/chatstates"/>' +
                    '</message>');

            // Draw message
            message._drawMessage('ours', app.options.username, msg);

            // User is no longer composing a message
            if(message._isComposing)
                message._isComposing = false;
        },

        /* Private Functions */
        _init: function(){
            var contact = message.contact = app.roster[window.name];
            message.name = contact.friendlyName;
            message.status = contact.status;
            message.show = contact.show;

            // Set window title
            window.nativeWindow.title = 'Chat with ' + message.name;

            // Fill in GUI elements with contact information
            message.controls.name.text(message.name);
            message.controls.status.text(message.status);
            message.controls.show.html('<span class="show show-'+message.show+'"></span>');

            if(contact.vCard.photo !== null){
                message.controls.pic.html('<img src="data:image;base64,'+contact.vCard.photo+'">');
            }

            /* Gui event handlers */

            // Enter to send
            message.controls.compose.on('keypress', function(e){
                if(e.keyCode == 13){
                    e.preventDefault();
                    message.sendMessage();
                    // Refocus the composition control
                    message.controls.compose.blur().focus();
                }else{
                    clearTimeout(message._composingTimeout);
                    message._beginComposing();
                    message._composingTimeout = setTimeout(function(){
                                    message._stopComposing();
                                }, 2000);
                }
            });

            // Click send
            message.controls.send.on('click', message.sendMessage);

            // Focus on window activation
            window.nativeWindow.addEventListener(air.Event.ACTIVATE, function(){
                setTimeout(function(){
                    message.controls.compose.focus();
                }, 25);
            });

            // ESC to close
            $window.on('keydown', function(e){
                if(e.keyCode == 27){
                    window.close();
                }
            });

            // Focus on the composition field if we start typing and it isn't in focus
            $window.on('keypress', function(e){
                if(!message.controls.compose[0].focused){
                    message.controls.compose.focus();
                }
            });

            // Open external links in system default browser
            message.controls.messages.on('click', '.external', function(e){
                e.preventDefault();
                var url = $(this).attr('href');

                // Make sure URL starts with http://
                if(url.indexOf('http://') !== 0){
                    url = 'http://' + url;
                }

                var urlReq = new air.URLRequest(url);
                air.navigateToURL(urlReq);
            });
        },

        /**
         * Draws a message in the conversation window.
         * @param author
         * @param jid
         * @param msg
         * @private
         */
        _drawMessage: function(author,jid,msg){
            // Gather contact information
            var name, photo = '';

            // Message author is current user
            if(jid === app.options.username){
                name = app.name;
                if(app.photo !== null){
                    photo = '<img src="data:image;base64,'+app.photo+'">';
                }
            }else{
                // Message author is contact
                name = message.name;
                if(message.contact.vCard.photo !== null){
                    photo = '<img src="data:image;base64,'+message.contact.vCard.photo+'">';
                }
            }

            // Create a timestamp for the message
            var date = new Date(),
                minutes = date.getMinutes(),
                minutes = (minutes < 10 ? '0' + minutes : minutes),
                hours = date.getHours(),
                hours = (hours > 12) ? (hours - 12) : hours,
                timestamp = (hours == 0 ? '12' : hours)+':'+minutes+((hours > 11) ? 'pm' : 'am');


            // Parse message formatting
            msg = message._parseMessage(msg);

            /*
             Consolidate messages. If multiple messages are being sent by the same party without
             interruption in a short span of time, display them in the same message block.
             */

            var li,
                timeSince = (new Date - message.lastMessage.time) / 1000;
            // same author, within 10 minutes
            if(message.lastMessage.author == author
                && timeSince < 600){
                li = message.controls.messages.children(':last-child');
                li.children('.timestamp').html(timestamp);
                li.children('.content').append('<br>'+msg);
            }else{
                li = '<li class="'+author+' message clearfix">'+
                    '<div class="pic">'+photo+'</div>'+
                    '<div class="timestamp">'+timestamp+'</div>'+
                    '<div class="name">'+name+'</div>'+
                    '<p class="content">'+msg+'</p>'+
                    '</li>';
                message.controls.messages.append(li);
                message.lastMessage.author = author;
                message.lastMessage.time = new Date();
            }

            if(message.lastMessage.author == null){
                message.lastMessage.author = author;
            }

            if(message.lastMessage.time == null){
                message.lastMessage.time = new Date().getTime();
            }

            // Correct scroll position
            message._scroll();
        },

        /**
         * Scrolls to the bottom of the conversation window.
         * @private
         */
        _scroll: function(){
            message.controls.content.scrollTop(message.controls.content[0].scrollHeight + 20);
        },

        /**
         * Updates the chatState for this conversation window.
         * Renders any "... is typing" messages and removes them as necessary.
         * @private
         */
        _updateChatState: function(chatStates){
            // The contact is composing
            if(chatStates.composing){
                message._showComposing();
                message.chatStates.composing = true;
            }
            else{
                message._hideComposing();
                message.chatStates.composing = false;
            }
        },

        /**
         * Shows the composing graphic.
         * @private
         */
        _showComposing: function(){
            message.controls.composing.html(message.name + ' is typing...').removeClass('hide');
            message._scroll();
        },

        /**
         * Hides the composing graphic.
         * @private
         */
        _hideComposing: function(){
            message.controls.composing.addClass('hide');
        },

        /**
         * Announces a contact's change in show.
         * @param show
         * @private
         */
        _updateShow: function(show){
            // Return if no change
            if(show == message.show) return;
            message.show = show;

            message.controls.show.html('<span class="show show-'+show+'"></span>');

            switch(show){
                case 'dnd':
                    show = 'busy';
                    break;
            }

            // add message to chat window
            message._systemMessage(message.name+' is '+show+'.');
        },

        /**
         * Updates the contact's photo
         * @param photo
         * @private
         */
        _updatePhoto: function(photo){
            message.controls.pic.html('<img src="data:image;base64,'+photo+'">');
        },

        /**
         * Announces a contact's change in status.
         * @param status
         * @private
         */
        _updateStatus: function(status){
            // Return if no change
            if(status == message.status) return;
            message.status = status;

            message.controls.status.text(status);

            if(status !== ''){
                // add message to chat window
                message._systemMessage(message.name+': '+status);
            }
        },

        /**
         * Inserts a system message into the conversation window.
         * @param msg
         * @private
         */
        _systemMessage: function(msg){
            message.lastMessage.author = null;
            message.lastMessage.time = null;
            message.controls.messages.append(
                '<li class="system">'+msg+'</li>'
            );
            message._scroll();
        },

        _receiveMessage: function(contact, body){
            // HTML entities
            body = util.htmlentities(body);

            message._drawMessage('theirs', contact, body);
        },

        /**
         * Parse message formattting.
         * Create links for all URLs.
         * Convert line break characters to HTML line breaks.
         * @param msg
         * @return {*}
         * @private
         */
        _parseMessage: function(msg){
            // Parse message for urls
            var urls = msg.match(/(https?:\/\/)?([\da-z\.-]+)\.([\?=\/\w\.-]*)*\/?/ig);
            if(urls){
                $.each(urls, function(i, match){
                    msg = msg.replace(match, '<a href="'+match+'" class="external">'+match+'</a>');
                });
            }

            // Convert line breaks to HTML breaks
            msg = util.nl2br(msg);

            return msg;
        },

        _beginComposing: function(){
            if(message._isComposing) return false;
            message._isComposing = true;

            // Send composing message
            var id = message.lastID++;
            app.stream.send(
                '<message to="'+message.contact.jid+'" type="chat" id="'+id+'" from="'+app.stream.fullJID+'">' +
                    '<composing xmlns="http://jabber.org/protocol/chatstates"/>' +
                    '</message>');
        },

        _stopComposing: function(){
            if(!message._isComposing) return false;
            message._isComposing = false;

            // Send composing message
            var id = message.lastID++;
            app.stream.send(
                '<message to="'+message.contact.jid+'" type="chat" id="'+id+'" from="'+app.stream.fullJID+'">' +
                    '<paused xmlns="http://jabber.org/protocol/chatstates"/>' +
                    '</message>');
        }
    };

    $document.ready(function(){
        message._init();
    });
    window.nativeWindow.addEventListener(air.Event.CLOSING, message.close);
})(window.opener.jQuery,
    window,
    document,
    window.opener.jQuery(window),
    window.opener.jQuery(document),
    window.opener.app,
    window.opener.util);