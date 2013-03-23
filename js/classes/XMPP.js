/*
    XMPP javascript client for Adobe Air
    (C) 2012 Andrew Becker
*/


/**
 * XMPP class constructor.
 * @param options
 * @constructor
 */
var XMPP = function(options){
    this.socket = options.socket;
    this.saslHash = options.saslHash;
    this.host = options.host;
    this.port = options.port;

    this.responses = {};
    this.features = null;
    this.roster = null;
    this.fullJID = null;
    
    // Private vars
    this._lastID = 2345;
    this._chunkData = '';
    this._receivingChunks = false;

    // Socket event handlers
    var XMPP = this;
    this.socket.addEventListener(air.Event.CONNECT, function(){ XMPP._openStream() });
    this.socket.addEventListener(air.Event.CLOSE, function(){ XMPP._close() }); // only fires when the SERVER not the client closes the connection
    this.socket.addEventListener(air.IOErrorEvent.IO_ERROR, function(e){ XMPP._ioErrorHandler(e) });
    this.socket.addEventListener(air.ProgressEvent.SOCKET_DATA, function(){ XMPP._socketData() });
    this.socket.addEventListener(air.SecurityErrorEvent.SECURITY_ERROR, function(e){ XMPP._securityErrorHandler(e) });

    // External event triggers
    this.events = options.events;
};

/*
Public Methods
 */

XMPP.prototype.connect = function(){
    try{
        air.trace('Connecting to '+this.host+':'+this.port);
        this.socket.connect(this.host,this.port);
    }catch(error){
        air.trace('** Connection error: ' + error.message);
        this.socket.close();
    }
};

XMPP.prototype.disconnect = function(){
    this.socket.close();
    this.trigger('disconnected');
};

XMPP.prototype._bufferAmount = 20;
XMPP.prototype._buffer = 0;
/**
 * Sends an XML formatted string to the socket. Optionally
 * bind a callback function to certain stanza responses.
 * Accepts multiple stanza bindings separated by a space.
 *
 * Usage:
 * XMPP.send('<xml here>');
 * XMPP.send('<sasl auth>', 'success failure', callback);
 *
 * @param output
 */
XMPP.prototype.send = function(output){
    var $this = this;
    // Bind handlers for certain stanza responses
    if(arguments.length == 3){
        var binds = arguments[1].toString().split(' '),
            callback = arguments[2];

        // Bind the callback for each stanza specified
        $.each(binds, function(i, bind){

            // Custom callback function removes all bindings for this callback
            $this.responses[bind] = function(stanza){

                // Remove all bindings
                $.each(binds, function(i, val){
                    delete $this.responses[val];
                });

                // call the callback function
                callback.call(this,stanza);
            };
        });
    }

    // Buffer outgoing stanzas
    var buffer = this._buffer += this._bufferAmount;
    setTimeout(function(){
        $this.socket.writeUTFBytes(output);
        $this.socket.flush();

        // Trigger general send event
        $this.trigger('send', output);

        // Reduce buffer accordingly
        $this._buffer -= $this._bufferAmount;
    }, buffer);
};

XMPP.prototype.trigger = function(event, output){
    event = this.events[event];
    if(typeof(event) == 'function'){
        event.call(this,output);
    }
};

XMPP.prototype.presence = function(show){
    switch(show){
        case 'away':
        case 'dnd':
        case 'unavailable':
        case 'online':
            break;
        default:
            show = 'online';
            break;
    }

    // status
    var status = '';
    if(arguments.length == 2 && arguments[1].length > 0){
        status = '<status>'+arguments[1]+'</status>';
    }

    var id = this._lastID++;
    this.send("<presence from='"+this.fullJID+"'><show>"+show+"</show>"+status+"<priority>24</priority></presence>");
};


/*
Private Methods
 */


/* Event Handlers */

/**
 * Negotiates the stream. Executes after a new stream tag has been opened
 * (on first connect, after authenticate and todo: after stream restart)
 * @param stanza
 * @private
 */
XMPP.prototype._negotiateStream = function(stanza){
    var $this = this,
        // Retrieve features
        features = stanza.xml.children('');

    $.each(features, function(i, feature){
        var name = feature.nodeName;
        switch(name){
            case 'mechanisms':
                // todo: proper mechanism detection
                $this._authenticate();
                break;

            case 'bind':
                $this._bind();
                break;
        }
    });
};

XMPP.prototype._authenticate = function(){
    this.send("<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>"+this.saslHash+"</auth>", 'success failure', function(stanza){
        if(stanza.type == 'success'){
            this._openStream();
        }else{
            // Retrieve error message
            var error = stanza.xml.children().get(0);
            if(typeof(error) !== 'undefined'){
                error = error.nodeName;
            }else{
                error = 'unknown';
            }
            switch(error){
                case 'not-authorized':
                    error = 'Invalid username/password';
                    break;
                case 'account-disabled':
                    error = 'Your account has been temporarily disabled';
                    break;
                default:
                    error = error + ' (1001)'; // error code 1001
                    break;
            }
            this.trigger('error', error);
            return false;
        }
    });
};

XMPP.prototype._bind = function(){
    var id = this._lastID++;
    this.send("<iq type='set' id='"+id+"'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>BetterTalk</resource></bind></iq>", id, function(stanza){
        var error = this._getError(stanza);
        if(!error){
            var bind = stanza.xml.children('bind');
            if(bind.length > 0){
                // Retrieve JID
                this.fullJID = bind.children('jid').text();
                this._session();
            }
        }else{
            switch(error){
                case 'resource-constraint':
                    error = 'Your account has reached a limit on the number of simultaneous connected resources allowed';
                    break;
                default:
                    error = error + ' (1002)'; // error code 1002
                    break;
            }
            this.trigger('error', error);
            return false;
        }

    });
};

XMPP.prototype._session = function(){
    var id = this._lastID++;
    this.send("<iq to='gmail.com' type='set' id='"+id+"'><session xmlns='urn:ietf:params:xml:ns:xmpp-session'/></iq>", id, function(stanza){
        var error = this._getError(stanza);
        if(!error){
            this._getRoster();
        }else{
            error = error + ' (1003)'; // error code 1003
            this.trigger('error', error);
        }
    });
};

XMPP.prototype._getRoster = function(){
    var id = this._lastID++;
    this.send('<iq from="'+this.fullJID+'" id="'+id+'" type="get"><query xmlns="jabber:iq:roster"/></iq>', id, function(stanza){
        var error = this._getError(stanza);
        if(!error){
            var query = stanza.xml.children('query'),
                $this = this,
                items = new Array();
            $.each(query.children('item'), function(){
                 var $item = $(this),
                     item = {
                         jid: $item.attr('jid').toLowerCase(),
                         sub: $item.attr('subscription'),
                         name: $item.attr('name')
                     };

                items.push(item);
            });

            this.trigger('roster', items);
        }else{
            error = error + ' (1004)'; // error code 1004
            this.trigger('error', error);
        }
    });
};

XMPP.prototype._receivePresence = function(stanza){
    // Determine presence type
    var type = stanza.xml.attr('type');

    // Contact update
    if(typeof(type) === 'undefined'){
        type = null;
    }

    stanza.presenceType = type;
    stanza.from = stanza.xml.attr('from');
    this.trigger('presence', stanza);
};

XMPP.prototype._receiveIQ = function(stanza){
    // Determine IQ type
    var type = stanza.xml.attr('type');

    switch(type){
        case 'set':
            // Determine query
            this.trigger('command', stanza);
            break;
        case 'result':

            break;
    }
};

XMPP.prototype._receiveMessage = function(stanza){
    var message = {
        stanza: stanza,
        type: stanza.xml.attr('type'),
        to: stanza.xml.attr('to'),
        from: stanza.xml.attr('from'),
        id: stanza.xml.attr('id'),
        body: stanza.xml.children('body').text(),
        chatStates: {
            active: stanza.xml.children('active').length,
            inactive: stanza.xml.children('inactive').length,
            gone: stanza.xml.children('gone').length,
            composing: stanza.xml.children('composing').length,
            paused: stanza.xml.children('paused').length
        }
    };

    // Evaluate base JID for contact
    var jid = message.from.split('/');
    message.jid = jid[0].toLowerCase();

    // The resource used to send the message
    message.resource = jid[1];

    this.trigger('message', message);
};

XMPP.prototype._messageHandler = function(stanza){
    switch(stanza.type){
        case 'presence':
            this._receivePresence(stanza);
            break;
        case 'iq':
            this._receiveIQ(stanza);
            break;
        case 'message':
            this._receiveMessage(stanza);
            break;
    }
};

XMPP.prototype._getError = function(stanza){
    var error = stanza.xml.attr('error');
    if(typeof(error) !== 'undefined'){
        error = stanza.xml.children('error');
        if(error.length > 0){
            return error.get(0).nodeName;
        }else{
            return 'unknown';
        }
    }else{
        return false;
    }
};

/* Socket Event Handlers */
XMPP.prototype._openStream = function(){
    var openStream = '<?xml version="1.0"?><stream:stream to="gmail.com" xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams" version="1.0">';

    // Open stream
    var $this = this;
    this.send(openStream, 'stream:features', function(stanza){
        $this._negotiateStream(stanza);
    });
};

XMPP.prototype._close = function(){
    this.trigger('disconnected');
};

XMPP.prototype._socketData = function(){
    var data = this.socket.readUTFBytes(this.socket.bytesAvailable);
    if(data.length < 2) return false;

    // todo: better way to receive the stream? this could be an air bug or the way google is sending the base64 data
    var end = data.substr(data.length-1,data.length);
    if(end !== '>'){
        this._receivingChunks = true;
        this._chunkData += data;
        return false;
    }else if(this._receivingChunks){
        // End of the chunk stream
        this._receivingChunks = false;
        data = this._chunkData + data;
        this._chunkData = '';
    }

    // Trigger general receive event
    this.trigger('receive', data);

    // Parse incoming stanzas into the proper classes
    var stanza = new XMPPStanza(data);

    // Fire response callback functions if any exist
    var handler;
    if(typeof(stanza.id) != 'undefined'){
        handler = stanza.id;
    }else{
        handler = stanza.type;
    }

    var callback = this.responses[handler];
    if(typeof(callback) == 'function'){
        callback.call(this,stanza);
    }else{
        this._messageHandler(stanza);
    }
};


XMPP.prototype._ioErrorHandler = function(e){
    this.trigger('error', e.text);
};

XMPP.prototype._securityErrorHandler = function(e){
    this.trigger('error', e.text);
};

/*
Response stanza classes
*/

// Generic response stanza parsing
var XMPPStanza = function(data){
    this.rawData = data;
    this.xml = $(new DOMParser().parseFromString(data,"text/xml").documentElement);

    // Remove parseerror
    this.xml.find('parsererror').remove();

    // Retrieve ID
    this.id = this.xml.attr('id');

    // Determine the stanza type
    this.type = this.xml[0].nodeName;
};