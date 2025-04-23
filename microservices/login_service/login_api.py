from spyne import Application, rpc, ServiceBase, Unicode, Boolean, ComplexModel, Fault
from spyne.protocol.soap import Soap11
from spyne.server.wsgi import WsgiApplication
from werkzeug.serving import run_simple
import logging
import os

logging.basicConfig(level=logging.DEBUG)

# Define input model
class LoginRequest(ComplexModel):
    __namespace__ = 'http://example.com/login'
    email = Unicode
    password = Unicode

# Define output model
class LoginResult(ComplexModel):
    __namespace__ = 'http://example.com/login'
    success = Boolean
    message = Unicode

# Sample user data
users = {
    "1@1": "1",
    "2": "2"
}

class LoginService(ServiceBase):
    @rpc(LoginRequest, _returns=LoginResult)
    def Login(ctx, request):
        try:
            
            email = request.email
            password = request.password
            logging.debug("Received login request: email=%s", email)
            if email in users and users[email] == password:
                return LoginResult(success=True, message="Login successful")
            else:
                return LoginResult(success=False, message="Invalid credentials")
        except Exception as e:
            logging.exception("Exception during Login operation")
            raise Fault(faultcode="Server", faultstring="Internal Server Error")

# Create the Spyne application with SOAP 1.1 protocol.
soap_app = Application(
    [LoginService],
    tns='http://example.com/login',
    in_protocol=Soap11(validator='lxml'),
    out_protocol=Soap11()
)

# Create the Spyne WSGI application.
wsgi_app = WsgiApplication(soap_app)

# --- CORS Middleware ---
def cors_app(app):
    def new_app(environ, start_response):
        if environ.get('REQUEST_METHOD', '') == 'OPTIONS':
            start_response('200 OK', [
                ('Content-Type', 'text/plain'),
                ('Access-Control-Allow-Origin', '*'),
                ('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'),
                ('Access-Control-Allow-Headers', 'Content-Type, SOAPAction'),
            ])
            return [b'']
        else:
            def custom_start_response(status, headers, exc_info=None):
                headers.append(('Access-Control-Allow-Origin', '*'))
                headers.append(('Access-Control-Allow-Methods', 'POST, GET, OPTIONS'))
                headers.append(('Access-Control-Allow-Headers', 'Content-Type, SOAPAction'))
                return start_response(status, headers, exc_info)
            return app(environ, custom_start_response)
    return new_app

app_with_cors = cors_app(wsgi_app)

# --- Static WSDL Middleware ---
def static_wsdl_app(environ, start_response):
    query = environ.get('QUERY_STRING', '')
    if 'wsdl' in query:
        try:
            with open('login_service.wsdl', 'rb') as f:
                wsdl_data = f.read()
            start_response('200 OK', [
                ('Content-Type', 'text/xml'),
                ('Access-Control-Allow-Origin', '*')
            ])
            return [wsdl_data]
        except Exception as e:
            start_response('500 Internal Server Error', [('Content-Type', 'text/plain')])
            return [b"Error reading WSDL file"]
    else:
        return app_with_cors(environ, start_response)

if __name__ == '__main__':
    # Run on 0.0.0.0:5001 inside the container (externally mapped to port 5005).
    run_simple('0.0.0.0', 5001, static_wsdl_app)
